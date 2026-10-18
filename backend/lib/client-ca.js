import crypto from "node:crypto";
import forge from "node-forge";

/**
 * Crypto helpers for the mTLS Client Certificate Authorities.
 *
 * Everything in here is pure and does not touch the disk or database.
 * Client private keys are only ever held in memory while a download
 * is being generated.
 */

const { pki, asn1 } = forge;

const ORGANIZATION = "Nginx Proxy Manager";
const CA_KEY_SIZE = 4096;
const CLIENT_KEY_SIZE = 2048;
const CRL_VALIDITY_DAYS = 30;

// CA certificates, CRLs and the bundles nginx uses for mTLS enabled hosts
const CLIENT_CA_DIR = "/data/client_ca";

const OID_AUTHORITY_KEY_IDENTIFIER = "2.5.29.35";
const OID_CRL_NUMBER = "2.5.29.20";

/**
 * Removes characters that would need escaping in an RFC 2253 distinguished name,
 * so nginx's $ssl_client_i_dn and $ssl_client_s_dn stay predictable.
 *
 * @param   {String} value
 * @returns {String}
 */
const sanitizeDnValue = (value) => {
	const clean = `${value}`
		.replace(/[,+"\\<>;=#/]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.substring(0, 64);
	return clean.length ? clean : "unnamed";
};

/**
 * The OU uniquely identifies the CA, this is used by nginx to check the issuer
 *
 * @param   {Integer} caId
 * @returns {String}
 */
const getCaUnitName = (caId) => {
	return `npm-client-ca-${caId}`;
};

/**
 * Random, positive, minimally encoded 128 bit serial number as hex
 *
 * @returns {String}
 */
const generateSerial = () => {
	const bytes = crypto.randomBytes(16);
	bytes[0] = (bytes[0] & 0x7f) | 0x01;
	return bytes.toString("hex").toUpperCase();
};

/**
 * Key generation runs in the libuv thread pool, so it doesn't block the event loop
 *
 * @param   {Integer} bits
 * @returns {Promise<String>}  PEM (PKCS#1)
 */
const generateRsaKey = (bits) => {
	return new Promise((resolve, reject) => {
		crypto.generateKeyPair(
			"rsa",
			{
				modulusLength: bits,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			},
			(err, _publicKey, privateKey) => (err ? reject(err) : resolve(privateKey)),
		);
	});
};

/**
 * @param   {String} privateKeyPem
 * @returns {Object} forge public key
 */
const getForgePublicKey = (privateKeyPem) => {
	const publicKeyPem = crypto.createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" });
	return pki.publicKeyFromPem(publicKeyPem);
};

/**
 * Signs a certificate with Node's native crypto, forge's pure JS RSA is slow for 4096 bit keys.
 * forge calls key.sign() once the TBS certificate has been built.
 *
 * @param   {Object} cert           forge certificate
 * @param   {String} privateKeyPem
 */
const signCertificate = (cert, privateKeyPem) => {
	cert.sign(
		{
			sign: () => signDer(asn1.toDer(cert.tbsCertificate).getBytes(), privateKeyPem),
		},
		forge.md.sha256.create(),
	);
};

/**
 * @param   {String} der            binary string
 * @param   {String} privateKeyPem
 * @returns {String}                binary string, sha256WithRSAEncryption signature
 */
const signDer = (der, privateKeyPem) => {
	return crypto.sign("sha256", Buffer.from(der, "binary"), privateKeyPem).toString("binary");
};

/**
 * Names are encoded as UTF8String, forge defaults to PrintableString
 * which can't hold umlauts, underscores and the like.
 *
 * @param   {String} name
 * @param   {String} value
 * @returns {Object}
 */
const dnAttribute = (name, value) => {
	return { name, value, valueTagClass: asn1.Type.UTF8 };
};

/**
 * forge returns UTF8String values of parsed certificates as raw bytes but encodes them
 * again when writing, decode them before a parsed name is used for another certificate
 *
 * @param   {Object} cert  forge certificate
 * @returns {Array}        subject attributes
 */
const getSubjectAttributes = (cert) => {
	return cert.subject.attributes.map((attr) => {
		if (attr.valueTagClass === asn1.Type.UTF8) {
			return { ...attr, value: forge.util.decodeUtf8(attr.value) };
		}
		return attr;
	});
};

/**
 * @param   {Date}    from
 * @param   {Integer} days
 * @returns {Date}
 */
const addDays = (from, days) => {
	return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
};

/**
 * Backdate a little to allow for clock skew between nginx and clients
 *
 * @returns {Date}
 */
const getNotBefore = () => {
	return new Date(Date.now() - 5 * 60 * 1000);
};

/**
 * @param   {Date}  date
 * @returns {Object}  asn1 Time
 */
const timeToAsn1 = (date) => {
	if (date.getUTCFullYear() >= 2050) {
		return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(date));
	}
	return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(date));
};

/**
 * @param   {Object} cert  forge certificate
 * @returns {String}       binary string
 */
const getKeyIdentifier = (cert) => {
	return pki.getPublicKeyFingerprint(cert.publicKey, { type: "RSAPublicKey" }).getBytes();
};

/**
 * Creates (or renews, when a key is given) a self signed CA certificate.
 * Renewing keeps the key and the subject so that all client certificates
 * issued by the previous CA certificate stay valid.
 *
 * @param   {Object}  data
 * @param   {Integer} data.id
 * @param   {String}  data.name
 * @param   {Integer} data.validity_days
 * @param   {String}  [data.private_key]  PEM of an existing key, for renewals
 * @returns {Promise<Object>}  { certificate, private_key, serial, expires_on }
 */
const createCaCertificate = async (data) => {
	const privateKey = data.private_key || (await generateRsaKey(CA_KEY_SIZE));

	const notBefore = getNotBefore();
	const notAfter = addDays(notBefore, data.validity_days);
	const serial = generateSerial();

	const attrs = [
		dnAttribute("commonName", sanitizeDnValue(data.name)),
		dnAttribute("organizationName", ORGANIZATION),
		dnAttribute("organizationalUnitName", getCaUnitName(data.id)),
	];

	const cert = pki.createCertificate();
	cert.publicKey = getForgePublicKey(privateKey);
	cert.serialNumber = serial;
	cert.validity.notBefore = notBefore;
	cert.validity.notAfter = notAfter;
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
		{ name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
		{ name: "subjectKeyIdentifier" },
		{ name: "authorityKeyIdentifier", keyIdentifier: getKeyIdentifier(cert) },
	]);
	signCertificate(cert, privateKey);

	return {
		certificate: pki.certificateToPem(cert),
		private_key: privateKey,
		serial: serial,
		expires_on: notAfter,
	};
};

/**
 * Issues a new client certificate with a freshly generated key.
 * The key is returned to the caller and must never be persisted.
 *
 * @param   {Object}  ca
 * @param   {String}  ca.certificate   PEM
 * @param   {String}  ca.private_key   PEM
 * @param   {Object}  data
 * @param   {String}  data.name
 * @param   {Integer} data.validity_days
 * @returns {Promise<Object>}  { certificate, private_key, serial, expires_on }
 */
const issueClientCertificate = async (ca, data) => {
	const caCert = pki.certificateFromPem(ca.certificate);
	const privateKey = await generateRsaKey(CLIENT_KEY_SIZE);

	const notBefore = getNotBefore();
	const notAfter = addDays(notBefore, data.validity_days);
	const serial = generateSerial();

	const cert = pki.createCertificate();
	cert.publicKey = getForgePublicKey(privateKey);
	cert.serialNumber = serial;
	cert.validity.notBefore = notBefore;
	cert.validity.notAfter = notAfter;
	cert.setSubject([
		dnAttribute("commonName", sanitizeDnValue(data.name)),
		dnAttribute("organizationName", ORGANIZATION),
	]);
	cert.setIssuer(getSubjectAttributes(caCert));
	cert.setExtensions([
		{ name: "basicConstraints", cA: false, critical: true },
		{ name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
		{ name: "extKeyUsage", clientAuth: true },
		{ name: "subjectKeyIdentifier" },
		{ name: "authorityKeyIdentifier", keyIdentifier: getKeyIdentifier(caCert) },
	]);
	signCertificate(cert, ca.private_key);

	return {
		certificate: pki.certificateToPem(cert),
		private_key: privateKey,
		serial: serial,
		expires_on: notAfter,
	};
};

/**
 * Builds a v2 CRL signed by the CA. node-forge has no CRL support,
 * so the ASN.1 structure is assembled by hand (RFC 5280, section 5.1).
 *
 * @param   {Object}  ca
 * @param   {String}  ca.certificate   PEM
 * @param   {String}  ca.private_key   PEM
 * @param   {Integer} crlNumber
 * @param   {Array}   revoked          [{ serial: "HEX", revoked_on: Date }]
 * @returns {Object}  { crl, next_update }
 */
const createCrl = (ca, crlNumber, revoked) => {
	const caCert = pki.certificateFromPem(ca.certificate);

	const thisUpdate = getNotBefore();
	const nextUpdate = addDays(thisUpdate, CRL_VALIDITY_DAYS);

	const sigAlg = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
		asn1.create(
			asn1.Class.UNIVERSAL,
			asn1.Type.OID,
			false,
			asn1.oidToDer(pki.oids.sha256WithRSAEncryption).getBytes(),
		),
		asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
	]);

	const makeExtension = (oid, valueAsn1) => {
		return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
			asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
			asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, asn1.toDer(valueAsn1).getBytes()),
		]);
	};

	const tbsFields = [
		asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
		sigAlg,
		pki.distinguishedNameToAsn1({ attributes: getSubjectAttributes(caCert) }),
		timeToAsn1(thisUpdate),
		timeToAsn1(nextUpdate),
	];

	if (revoked.length) {
		tbsFields.push(
			asn1.create(
				asn1.Class.UNIVERSAL,
				asn1.Type.SEQUENCE,
				true,
				revoked.map((item) => {
					return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
						asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes(item.serial)),
						timeToAsn1(new Date(item.revoked_on)),
					]);
				}),
			),
		);
	}

	tbsFields.push(
		asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
			asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
				makeExtension(
					OID_AUTHORITY_KEY_IDENTIFIER,
					asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
						asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, false, getKeyIdentifier(caCert)),
					]),
				),
				makeExtension(
					OID_CRL_NUMBER,
					asn1.create(
						asn1.Class.UNIVERSAL,
						asn1.Type.INTEGER,
						false,
						asn1.integerToDer(crlNumber).getBytes(),
					),
				),
			]),
		]),
	);

	const tbs = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, tbsFields);

	const signature = signDer(asn1.toDer(tbs).getBytes(), ca.private_key);

	const crl = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
		tbs,
		sigAlg,
		asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, String.fromCharCode(0x00) + signature),
	]);

	return {
		crl: forge.pem.encode({ type: "X509 CRL", body: asn1.toDer(crl).getBytes() }),
		next_update: nextUpdate,
	};
};

/**
 * PKCS#12 bundle, for importing into browsers and operating systems
 *
 * @param   {Object}  data
 * @param   {String}  data.certificate     PEM
 * @param   {String}  data.private_key     PEM
 * @param   {String}  data.ca_certificate  PEM
 * @param   {String}  data.name
 * @param   {String}  data.password
 * @returns {Buffer}
 */
const toPkcs12 = (data) => {
	const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
		pki.privateKeyFromPem(data.private_key),
		[pki.certificateFromPem(data.certificate), pki.certificateFromPem(data.ca_certificate)],
		data.password,
		{ algorithm: "3des", friendlyName: sanitizeDnValue(data.name) },
	);
	return Buffer.from(asn1.toDer(p12Asn1).getBytes(), "binary");
};

/**
 * Combined PEM file with the key, the certificate and the CA certificate.
 * The key is encrypted when a password is given.
 *
 * @param   {Object}  data
 * @param   {String}  data.certificate     PEM
 * @param   {String}  data.private_key     PEM
 * @param   {String}  data.ca_certificate  PEM
 * @param   {String}  [data.password]
 * @returns {String}
 */
const toPem = (data) => {
	const keyObject = crypto.createPrivateKey(data.private_key);
	const exportOptions = { type: "pkcs8", format: "pem" };
	if (data.password) {
		exportOptions.cipher = "aes-256-cbc";
		exportOptions.passphrase = data.password;
	}
	return [keyObject.export(exportOptions).trim(), data.certificate.trim(), data.ca_certificate.trim(), ""].join("\n");
};

/**
 * @param   {String} pem
 * @returns {Object} { serial, subject, issuer, not_before, not_after, fingerprint }
 */
const getCertificateInfo = (pem) => {
	const x509 = new crypto.X509Certificate(pem);
	return {
		serial: x509.serialNumber,
		subject: x509.subject,
		issuer: x509.issuer,
		not_before: new Date(x509.validFrom),
		not_after: new Date(x509.validTo),
		fingerprint: x509.fingerprint256,
	};
};

/**
 * @param   {String} pem
 * @returns {String}
 */
const getSubjectCommonName = (pem) => {
	return getSubjectAttributes(pki.certificateFromPem(pem)).find((attr) => attr.shortName === "CN")?.value || "";
};

export {
	CLIENT_CA_DIR,
	createCaCertificate,
	createCrl,
	getCaUnitName,
	getCertificateInfo,
	getSubjectCommonName,
	issueClientCertificate,
	sanitizeDnValue,
	toPem,
	toPkcs12,
};

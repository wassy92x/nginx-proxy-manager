import fs from "node:fs";
import _ from "lodash";
import moment from "moment";
import { ref } from "objection";
import {
	CLIENT_CA_DIR,
	createCaCertificate,
	createCrl,
	getCertificateInfo,
	getSubjectCommonName,
	issueClientCertificate,
	toPem,
	toPkcs12,
} from "../lib/client-ca.js";
import errs from "../lib/error.js";
import utils from "../lib/utils.js";
import { clientCa as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import clientCaModel from "../models/client_ca.js";
import clientCertificateModel from "../models/client_certificate.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";

const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";
const BUNDLE_FILE_PATTERN = /^bundle-([0-9]+(?:-[0-9]+)*)\.pem$/;

// Pending CRL builds per CA, so concurrent builds don't overwrite each other
const crlQueue = {};

const omissions = () => {
	return ["is_deleted"];
};

/**
 * @param   {Date|String}  date
 * @returns {String}
 */
const formatDate = (date) => {
	return moment(date).format(DATE_FORMAT);
};

/**
 * Turns a name into something safe to use as a download filename
 *
 * @param   {String} name
 * @returns {String}
 */
const getDownloadName = (name) => {
	const clean = `${name}`.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
	return clean.length ? clean : "client";
};

/**
 * Subquery for the number of client certificates of a CA that are neither revoked nor expired
 *
 * @returns {Object}
 */
const activeCertificateCount = () => {
	return clientCertificateModel
		.query()
		.count()
		.where("client_certificate.client_ca_id", ref("client_ca.id"))
		.andWhere("client_certificate.is_deleted", 0)
		.andWhere("client_certificate.revoked", 0)
		.andWhere("client_certificate.expires_on", ">", formatDate(new Date()))
		.as("client_certificate_count");
};

const internalClientCa = {
	intervalTimeout: 1000 * 60 * 60, // 1 hour
	interval: null,
	intervalProcessing: false,

	// CRLs are valid for 30 days, refresh them well before they expire
	crlRefreshBeforeDays: 7,

	/**
	 * Days before expiry at which a CA is renewed in the background
	 *
	 * @param   {Integer} validityDays
	 * @returns {Integer}
	 */
	getRenewBeforeDays: (validityDays) => {
		return Math.max(1, Math.min(30, Math.floor(validityDays / 3)));
	},

	/**
	 * The CA certificates and CRLs nginx uses for a host. There is one bundle per
	 * combination of CAs, so a host only asks for certificates of the CAs it trusts.
	 *
	 * @param   {Array}  caIds
	 * @returns {Object} { ca, crl }
	 */
	getBundleFilenames: (caIds) => {
		const key = _.sortBy(_.uniq(caIds)).join("-");
		return {
			ca: `${CLIENT_CA_DIR}/bundle-${key}.pem`,
			crl: `${CLIENT_CA_DIR}/bundle-${key}.crl.pem`,
		};
	},

	/**
	 * Like Let's Encrypt and custom certificates, the CA certificate and its key
	 * live on the file system, the database only holds the meta data
	 *
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {String}
	 */
	getCaPath: (ca) => {
		return `${CLIENT_CA_DIR}/npm-${ca.id}`;
	},

	/**
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {String}
	 */
	getCertificateFilename: (ca) => {
		return `${internalClientCa.getCaPath(ca)}/cert.pem`;
	},

	/**
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {String}
	 */
	getKeyFilename: (ca) => {
		return `${internalClientCa.getCaPath(ca)}/privkey.pem`;
	},

	/**
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {String}
	 */
	getCrlFilename: (ca) => {
		return `${internalClientCa.getCaPath(ca)}/crl.pem`;
	},

	/**
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {Object}  { certificate, private_key } PEMs
	 */
	readCaFiles: (ca) => {
		try {
			return {
				certificate: fs.readFileSync(internalClientCa.getCertificateFilename(ca), { encoding: "utf8" }),
				private_key: fs.readFileSync(internalClientCa.getKeyFilename(ca), { encoding: "utf8" }),
			};
		} catch (err) {
			throw new errs.ConfigurationError(`Client CA #${ca.id} files could not be read: ${err.message}`);
		}
	},

	/**
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @param   {Object}  files
	 * @param   {String}  files.certificate    PEM
	 * @param   {String}  [files.private_key]  PEM, only written when given
	 */
	writeCaFiles: (ca, files) => {
		fs.mkdirSync(CLIENT_CA_DIR, { recursive: true });
		// Only the backend needs the key, nginx reads the bundles in the parent folder
		fs.mkdirSync(internalClientCa.getCaPath(ca), { recursive: true, mode: 0o700 });
		if (files.private_key) {
			fs.writeFileSync(internalClientCa.getKeyFilename(ca), files.private_key, { encoding: "utf8", mode: 0o600 });
			fs.chmodSync(internalClientCa.getKeyFilename(ca), 0o600);
		}
		fs.writeFileSync(internalClientCa.getCertificateFilename(ca), files.certificate, { encoding: "utf8" });
	},

	initTimer: () => {
		logger.info("Client CA Renewal Timer initialized");
		internalClientCa.interval = setInterval(internalClientCa.processCas, internalClientCa.intervalTimeout);
		// And do this now as well
		internalClientCa.processCas();
	},

	/**
	 * Triggered by a timer, this renews CAs that are about to expire,
	 * refreshes CRLs before they run out and makes sure the files
	 * nginx needs are in place.
	 *
	 * Client certificates are never renewed automatically.
	 */
	processCas: async () => {
		if (internalClientCa.intervalProcessing) {
			return;
		}
		internalClientCa.intervalProcessing = true;

		try {
			const cas = await clientCaModel.query().where("is_deleted", 0);
			let changed = false;

			for (const ca of cas) {
				try {
					const renewBefore = moment().add(internalClientCa.getRenewBeforeDays(ca.validity_days), "days");
					if (moment(ca.expires_on).isBefore(renewBefore)) {
						logger.info(`Renewing Client CA #${ca.id}: ${ca.name}`);
						await internalClientCa.renewCertificate(ca);
						changed = true;
						continue;
					}

					const crlRefresh = moment().add(internalClientCa.crlRefreshBeforeDays, "days");
					if (
						!ca.crl_next_update ||
						moment(ca.crl_next_update).isBefore(crlRefresh) ||
						!fs.existsSync(internalClientCa.getCrlFilename(ca))
					) {
						await internalClientCa.buildCrl(ca);
						changed = true;
					}
				} catch (err) {
					// Don't want to stop the train here, just log the error
					logger.error(`Client CA #${ca.id}: ${err.message}`);
				}
			}

			await internalClientCa.writeBundles();
			if (changed) {
				await internalNginx.reload();
			}
		} catch (err) {
			logger.error(err.message);
		}

		internalClientCa.intervalProcessing = false;
	},

	/**
	 * Re-signs the CA certificate with the existing key and subject,
	 * so that client certificates issued earlier remain valid.
	 *
	 * @param   {Object}  ca
	 * @returns {Promise}
	 */
	renewCertificate: async (ca) => {
		const files = internalClientCa.readCaFiles(ca);
		const generated = await createCaCertificate({
			id: ca.id,
			name: getSubjectCommonName(files.certificate),
			validity_days: ca.validity_days,
			private_key: files.private_key,
		});
		const info = getCertificateInfo(generated.certificate);

		internalClientCa.writeCaFiles(ca, { certificate: generated.certificate });
		await clientCaModel
			.query()
			.where("id", ca.id)
			.patch({
				expires_on: formatDate(generated.expires_on),
				meta: _.assign({}, ca.meta, {
					serial: info.serial,
					fingerprint: info.fingerprint,
					renewed_on: formatDate(new Date()),
				}),
			});

		await internalClientCa.buildCrl(ca);
		logger.success(`Renewed Client CA #${ca.id}: ${ca.name}`);
	},

	/**
	 * Generates and writes the CRL for a CA. Revoked certificates stay on
	 * the list until they expire, even when they have been deleted.
	 * Builds for the same CA run one after the other and always use fresh data.
	 *
	 * @param   {Object}  ca
	 * @param   {Integer} ca.id
	 * @returns {Promise}
	 */
	buildCrl: (ca) => {
		const previous = crlQueue[ca.id] || Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(async () => {
				const freshCa = await clientCaModel.query().findById(ca.id);
				const revoked = await clientCertificateModel
					.query()
					.where("client_ca_id", ca.id)
					.andWhere("revoked", 1)
					.andWhere("expires_on", ">", formatDate(new Date()));

				const crlNumber = (freshCa.crl_number || 0) + 1;
				const result = createCrl(
					internalClientCa.readCaFiles(ca),
					crlNumber,
					revoked.map((cert) => {
						return {
							serial: cert.serial,
							revoked_on: moment(cert.revoked_on || cert.modified_on).toDate(),
						};
					}),
				);

				fs.writeFileSync(internalClientCa.getCrlFilename(ca), result.crl, { encoding: "utf8" });

				await clientCaModel
					.query()
					.where("id", ca.id)
					.patch({
						crl_number: crlNumber,
						crl_next_update: formatDate(result.next_update),
					});
			});

		crlQueue[ca.id] = next;
		return next.finally(() => {
			if (crlQueue[ca.id] === next) {
				delete crlQueue[ca.id];
			}
		});
	},

	/**
	 * Writes the CA certificate and CRL bundle for a combination of CAs
	 *
	 * @param   {Array}  caIds
	 * @returns {Promise<Object>} { ca, crl } filenames
	 */
	writeBundle: async (caIds) => {
		const files = internalClientCa.getBundleFilenames(caIds);
		const cas = await clientCaModel.query().where("is_deleted", 0).whereIn("id", caIds).orderBy("id");

		const caCerts = [];
		const crls = [];
		for (const ca of cas) {
			if (!fs.existsSync(internalClientCa.getCertificateFilename(ca))) {
				logger.warn(
					`Client CA #${ca.id} certificate is missing: ${internalClientCa.getCertificateFilename(ca)}`,
				);
				continue;
			}
			if (!fs.existsSync(internalClientCa.getCrlFilename(ca))) {
				await internalClientCa.buildCrl(ca);
			}
			caCerts.push(fs.readFileSync(internalClientCa.getCertificateFilename(ca), { encoding: "utf8" }).trim());
			crls.push(fs.readFileSync(internalClientCa.getCrlFilename(ca), { encoding: "utf8" }).trim());
		}

		fs.mkdirSync(CLIENT_CA_DIR, { recursive: true });
		if (!caCerts.length) {
			// None of these CAs exist anymore, so no host can use this bundle
			internalNginx.deleteFile(files.ca);
			internalNginx.deleteFile(files.crl);
			return files;
		}
		fs.writeFileSync(files.ca, `${caCerts.join("\n")}\n`, { encoding: "utf8" });
		fs.writeFileSync(files.crl, `${crls.join("\n")}\n`, { encoding: "utf8" });
		return files;
	},

	/**
	 * Rewrites every bundle that exists, after a CA or CRL changed
	 *
	 * @returns {Promise}
	 */
	writeBundles: async () => {
		if (!fs.existsSync(CLIENT_CA_DIR)) {
			return;
		}
		for (const filename of fs.readdirSync(CLIENT_CA_DIR)) {
			const match = filename.match(BUNDLE_FILE_PATTERN);
			if (match) {
				await internalClientCa.writeBundle(match[1].split("-").map((id) => Number.parseInt(id, 10)));
			}
		}
	},

	/**
	 * Writes the bundles and reloads nginx, used after anything changed
	 *
	 * @returns {Promise}
	 */
	apply: async () => {
		await internalClientCa.writeBundles();
		await internalNginx.reload();
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {String}  data.name
	 * @param   {Integer} data.validity_days
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		await access.can("client_cas:create", data);

		const row = await clientCaModel.query().insertAndFetch({
			name: data.name,
			validity_days: data.validity_days,
			owner_user_id: access.token.getUserId(1),
			expires_on: formatDate(new Date()),
		});

		try {
			const generated = await createCaCertificate({
				id: row.id,
				name: data.name,
				validity_days: data.validity_days,
			});
			const info = getCertificateInfo(generated.certificate);

			internalClientCa.writeCaFiles(row, generated);
			await clientCaModel
				.query()
				.where("id", row.id)
				.patch({
					expires_on: formatDate(generated.expires_on),
					meta: {
						serial: info.serial,
						fingerprint: info.fingerprint,
					},
				});

			await internalClientCa.buildCrl(row);
		} catch (err) {
			// Don't leave a half created CA behind
			await clientCaModel.query().where("id", row.id).patch({ is_deleted: 1 });
			fs.rmSync(internalClientCa.getCaPath(row), { recursive: true, force: true });
			throw err;
		}

		const freshRow = await internalClientCa.get(access, { id: row.id, expand: ["owner"] });

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "client-ca",
			object_id: freshRow.id,
			meta: _.pick(freshRow, ["name", "validity_days", "expires_on"]),
		});

		return freshRow;
	},

	/**
	 * Changing the validity applies from the next renewal onwards.
	 * The name is a label only, the certificate subject is never changed
	 * as that would invalidate all client certificates.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.id
	 * @param   {String}  [data.name]
	 * @param   {Integer} [data.validity_days]
	 * @returns {Promise}
	 */
	update: async (access, data) => {
		await access.can("client_cas:update", data.id);
		const row = await internalClientCa.get(access, { id: data.id });
		if (row.id !== data.id) {
			// Sanity check that something crazy hasn't happened
			throw new errs.InternalValidationError(
				`Client CA could not be updated, IDs do not match: ${row.id} !== ${data.id}`,
			);
		}

		const patch = _.pick(data, ["name", "validity_days"]);
		if (Object.keys(patch).length) {
			await clientCaModel.query().where("id", data.id).patch(patch);
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "client-ca",
			object_id: data.id,
			meta: patch,
		});

		return internalClientCa.get(access, { id: data.id, expand: ["owner"] });
	},

	/**
	 * Renews the CA certificate right now, instead of waiting for the timer
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	renew: async (access, data) => {
		await access.can("client_cas:update", data.id);
		await internalClientCa.get(access, { id: data.id });

		const ca = await clientCaModel.query().findById(data.id);
		await internalClientCa.renewCertificate(ca);
		await internalClientCa.apply();

		const freshRow = await internalClientCa.get(access, { id: data.id, expand: ["owner"] });

		await internalAuditLog.add(access, {
			action: "renewed",
			object_type: "client-ca",
			object_id: data.id,
			meta: _.pick(freshRow, ["name", "expires_on"]),
		});

		return freshRow;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {Integer}  data.id
	 * @param  {Array}    [data.expand]
	 * @param  {Array}    [data.omit]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		const thisData = data || {};
		const accessData = await access.can("client_cas:get", thisData.id);

		const query = clientCaModel
			.query()
			.select("client_ca.*", activeCertificateCount())
			.where("client_ca.is_deleted", 0)
			.andWhere("client_ca.id", thisData.id)
			.allowGraph("[owner,certificates]")
			.first();

		if (accessData.permission_visibility !== "all") {
			query.andWhere("client_ca.owner_user_id", access.token.getUserId(1));
		}

		if (typeof thisData.expand !== "undefined" && thisData.expand !== null) {
			query.withGraphFetched(`[${thisData.expand.join(", ")}]`);
		}

		let row = await query.then(utils.omitRow(omissions()));

		if (!row?.id) {
			throw new errs.ItemNotFoundError(thisData.id);
		}
		// Custom omissions
		if (typeof data.omit !== "undefined" && data.omit !== null) {
			row = _.omit(row, data.omit);
		}
		return row;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		await access.can("client_cas:delete", data.id);
		const row = await internalClientCa.get(access, { id: data.id });

		// Removing a CA that an access list relies on would silently turn off mTLS for its hosts
		const accessLists = await accessListModel
			.query()
			.select("access_list.id", "access_list.name")
			.join("access_list_client_ca", "access_list_client_ca.access_list_id", "access_list.id")
			.where("access_list.is_deleted", 0)
			.andWhere("access_list_client_ca.client_ca_id", row.id);

		if (accessLists.length) {
			throw new errs.ValidationError(
				`This Client CA is still used by these Access Lists: ${accessLists.map((list) => list.name).join(", ")}`,
			);
		}

		await clientCaModel.query().where("id", row.id).patch({ is_deleted: 1 });
		await clientCertificateModel.query().where("client_ca_id", row.id).patch({ is_deleted: 1 });

		// The key goes with the CA, like the files of a deleted Let's Encrypt certificate
		fs.rmSync(internalClientCa.getCaPath(row), { recursive: true, force: true });

		await internalClientCa.apply();

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "client-ca",
			object_id: row.id,
			meta: _.pick(row, ["name", "validity_days", "expires_on"]),
		});

		return true;
	},

	/**
	 * @param   {Access}  access
	 * @param   {Array}   [expand]
	 * @param   {String}  [searchQuery]
	 * @returns {Promise}
	 */
	getAll: async (access, expand, searchQuery) => {
		const accessData = await access.can("client_cas:list");

		const query = clientCaModel
			.query()
			.select("client_ca.*", activeCertificateCount())
			.where("client_ca.is_deleted", 0)
			.allowGraph("[owner,certificates]")
			.orderBy("client_ca.name", "ASC");

		if (accessData.permission_visibility !== "all") {
			query.andWhere("client_ca.owner_user_id", access.token.getUserId(1));
		}

		// Query is used for searching
		if (typeof searchQuery === "string") {
			query.where(function () {
				this.where("client_ca.name", "like", `%${searchQuery}%`);
			});
		}

		if (typeof expand !== "undefined" && expand !== null) {
			query.withGraphFetched(`[${expand.join(", ")}]`);
		}

		return query.then(utils.omitRows(omissions()));
	},

	/**
	 * The public CA certificate, eg. for clients that want to verify the chain
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	download: async (access, data) => {
		const row = await internalClientCa.get(access, { id: data.id });
		return {
			filename: `${getDownloadName(row.name)}-ca.pem`,
			content_type: "application/x-pem-file",
			data: Buffer.from(internalClientCa.readCaFiles(row).certificate, "utf8"),
		};
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.client_ca_id
	 * @returns {Promise}
	 */
	getCertificates: async (access, data) => {
		const ca = await internalClientCa.get(access, { id: data.client_ca_id });
		return clientCertificateModel
			.query()
			.where("client_ca_id", ca.id)
			.andWhere("is_deleted", 0)
			.orderBy("created_on", "DESC")
			.then(utils.omitRows(["is_deleted"]));
	},

	/**
	 * Issues a client certificate. The private key is generated right now,
	 * returned once as part of the download and never stored.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.client_ca_id
	 * @param   {String}  data.name
	 * @param   {Integer} data.validity_days
	 * @param   {String}  data.format     pkcs12 or pem
	 * @param   {String}  [data.password]
	 * @returns {Promise} { certificate, file: { filename, content_type, data } }
	 */
	issueCertificate: async (access, data) => {
		await access.can("client_cas:update", data.client_ca_id);
		await internalClientCa.get(access, { id: data.client_ca_id });

		if (data.format === "pkcs12" && !data.password) {
			throw new errs.ValidationError("A password is required for PKCS#12 files");
		}

		const ca = await clientCaModel.query().findById(data.client_ca_id);
		if (moment(ca.expires_on).isBefore(moment())) {
			throw new errs.ValidationError("The Client CA has expired, renew it first");
		}

		const caFiles = internalClientCa.readCaFiles(ca);
		const issued = await issueClientCertificate(caFiles, {
			name: data.name,
			validity_days: data.validity_days,
		});
		const info = getCertificateInfo(issued.certificate);

		// Build the download first, a certificate whose key nobody received must not be recorded
		const bundleData = {
			certificate: issued.certificate,
			private_key: issued.private_key,
			ca_certificate: caFiles.certificate,
			name: data.name,
			password: data.password,
		};

		const file =
			data.format === "pem"
				? {
						filename: `${getDownloadName(data.name)}.pem`,
						content_type: "application/x-pem-file",
						data: Buffer.from(toPem(bundleData), "utf8"),
					}
				: {
						filename: `${getDownloadName(data.name)}.p12`,
						content_type: "application/x-pkcs12",
						data: toPkcs12(bundleData),
					};

		const row = await clientCertificateModel.query().insertAndFetch({
			owner_user_id: access.token.getUserId(1),
			client_ca_id: ca.id,
			name: data.name,
			serial: issued.serial,
			expires_on: formatDate(issued.expires_on),
			meta: {
				fingerprint: info.fingerprint,
				subject: info.subject,
			},
		});

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "client-certificate",
			object_id: row.id,
			meta: {
				name: row.name,
				serial: row.serial,
				client_ca_id: ca.id,
				client_ca_name: ca.name,
				expires_on: row.expires_on,
			},
		});

		return {
			certificate: _.omit(row, ["is_deleted"]),
			file,
		};
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.client_ca_id
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	getCertificate: async (access, data) => {
		await internalClientCa.get(access, { id: data.client_ca_id });
		const row = await clientCertificateModel
			.query()
			.where("client_ca_id", data.client_ca_id)
			.andWhere("id", data.id)
			.andWhere("is_deleted", 0)
			.first();

		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}
		return row;
	},

	/**
	 * Adds the certificate to the CRL of its CA
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.client_ca_id
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	revokeCertificate: async (access, data) => {
		await access.can("client_cas:update", data.client_ca_id);
		const row = await internalClientCa.getCertificate(access, data);

		if (!row.revoked) {
			await clientCertificateModel
				.query()
				.where("id", row.id)
				.patch({
					revoked: true,
					revoked_on: formatDate(new Date()),
				});

			await internalClientCa.buildCrl({ id: data.client_ca_id });
			await internalClientCa.apply();

			await internalAuditLog.add(access, {
				action: "revoked",
				object_type: "client-certificate",
				object_id: row.id,
				meta: _.pick(row, ["name", "serial", "client_ca_id", "expires_on"]),
			});
		}

		return _.omit(await clientCertificateModel.query().findById(row.id), ["is_deleted"]);
	},

	/**
	 * Deleting a certificate that is still valid revokes it first,
	 * it stays on the CRL until it expires.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @param   {Integer} data.client_ca_id
	 * @param   {Integer} data.id
	 * @returns {Promise}
	 */
	deleteCertificate: async (access, data) => {
		await access.can("client_cas:update", data.client_ca_id);
		const row = await internalClientCa.getCertificate(access, data);

		const needsRevoking = !row.revoked && moment(row.expires_on).isAfter(moment());

		await clientCertificateModel
			.query()
			.where("id", row.id)
			.patch(
				needsRevoking
					? {
							is_deleted: true,
							revoked: true,
							revoked_on: formatDate(new Date()),
						}
					: { is_deleted: true },
			);

		if (needsRevoking) {
			await internalClientCa.buildCrl({ id: data.client_ca_id });
			await internalClientCa.apply();
		}

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "client-certificate",
			object_id: row.id,
			meta: _.pick(row, ["name", "serial", "client_ca_id", "expires_on"]),
		});

		return true;
	},
};

export default internalClientCa;

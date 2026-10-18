import express from "express";
import internalClientCa from "../../internal/client-ca.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import apiValidator from "../../lib/validator/api.js";
import validator from "../../lib/validator/index.js";
import { debug, express as logger } from "../../logger.js";
import { getValidationSchema } from "../../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * Sends a generated file as a download. Responses that contain
 * private keys must never be cached anywhere.
 *
 * @param {Object}  res
 * @param {Object}  file
 * @param {Integer} [status]
 */
const sendFile = (res, file, status) => {
	// attachment() sets a Content-Type from the extension, so it has to come first
	res.status(status || 200)
		.attachment(file.filename)
		.set({
			"Content-Type": file.content_type,
			"Cache-Control": "no-store",
			"Access-Control-Expose-Headers": "Content-Disposition, X-Client-Certificate-Id",
		})
		.send(file.data);
};

/**
 * /api/nginx/client-cas
 */
router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/client-cas
	 *
	 * Retrieve all client CAs
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					additionalProperties: false,
					properties: {
						expand: {
							$ref: "common#/properties/expand",
						},
						query: {
							$ref: "common#/properties/query",
						},
					},
				},
				{
					expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
					query: typeof req.query.query === "string" ? req.query.query : null,
				},
			);
			const rows = await internalClientCa.getAll(res.locals.access, data.expand, data.query);
			res.status(200).send(rows);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * POST /api/nginx/client-cas
	 *
	 * Create a new client CA
	 */
	.post(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/nginx/client-cas", "post"), req.body);
			const result = await internalClientCa.create(res.locals.access, payload);
			res.status(201).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Specific client CA
 *
 * /api/nginx/client-cas/123
 */
router
	.route("/:ca_id")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/client-cas/123
	 *
	 * Retrieve a specific client CA
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["ca_id"],
					additionalProperties: false,
					properties: {
						ca_id: {
							$ref: "common#/properties/id",
						},
						expand: {
							$ref: "common#/properties/expand",
						},
					},
				},
				{
					ca_id: req.params.ca_id,
					expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
				},
			);
			const row = await internalClientCa.get(res.locals.access, {
				id: Number.parseInt(data.ca_id, 10),
				expand: data.expand,
			});
			res.status(200).send(row);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * PUT /api/nginx/client-cas/123
	 *
	 * Update an existing client CA
	 */
	.put(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/nginx/client-cas/{caID}", "put"), req.body);
			payload.id = Number.parseInt(req.params.ca_id, 10);
			const result = await internalClientCa.update(res.locals.access, payload);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * DELETE /api/nginx/client-cas/123
	 *
	 * Delete an existing client CA
	 */
	.delete(async (req, res, next) => {
		try {
			const result = await internalClientCa.delete(res.locals.access, {
				id: Number.parseInt(req.params.ca_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Renew a client CA now
 *
 * /api/nginx/client-cas/123/renew
 */
router
	.route("/:ca_id/renew")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/client-cas/123/renew
	 */
	.post(async (req, res, next) => {
		try {
			const result = await internalClientCa.renew(res.locals.access, {
				id: Number.parseInt(req.params.ca_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Download the CA certificate
 *
 * /api/nginx/client-cas/123/download
 */
router
	.route("/:ca_id/download")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/client-cas/123/download
	 */
	.get(async (req, res, next) => {
		try {
			const file = await internalClientCa.download(res.locals.access, {
				id: Number.parseInt(req.params.ca_id, 10),
			});
			sendFile(res, file);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Client certificates of a CA
 *
 * /api/nginx/client-cas/123/certificates
 */
router
	.route("/:ca_id/certificates")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/nginx/client-cas/123/certificates
	 */
	.get(async (req, res, next) => {
		try {
			const rows = await internalClientCa.getCertificates(res.locals.access, {
				client_ca_id: Number.parseInt(req.params.ca_id, 10),
			});
			res.status(200).send(rows);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * POST /api/nginx/client-cas/123/certificates
	 *
	 * Issues a certificate and returns it, with its freshly generated key, as a download
	 */
	.post(async (req, res, next) => {
		try {
			const payload = await apiValidator(
				getValidationSchema("/nginx/client-cas/{caID}/certificates", "post"),
				req.body,
			);
			payload.client_ca_id = Number.parseInt(req.params.ca_id, 10);
			const result = await internalClientCa.issueCertificate(res.locals.access, payload);
			res.set("X-Client-Certificate-Id", `${result.certificate.id}`);
			sendFile(res, result.file, 201);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Specific client certificate
 *
 * /api/nginx/client-cas/123/certificates/456
 */
router
	.route("/:ca_id/certificates/:certificate_id")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * DELETE /api/nginx/client-cas/123/certificates/456
	 */
	.delete(async (req, res, next) => {
		try {
			const result = await internalClientCa.deleteCertificate(res.locals.access, {
				client_ca_id: Number.parseInt(req.params.ca_id, 10),
				id: Number.parseInt(req.params.certificate_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Revoke a client certificate
 *
 * /api/nginx/client-cas/123/certificates/456/revoke
 */
router
	.route("/:ca_id/certificates/:certificate_id/revoke")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * POST /api/nginx/client-cas/123/certificates/456/revoke
	 */
	.post(async (req, res, next) => {
		try {
			const result = await internalClientCa.revokeCertificate(res.locals.access, {
				client_ca_id: Number.parseInt(req.params.ca_id, 10),
				id: Number.parseInt(req.params.certificate_id, 10),
			});
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;

// Objection Docs:
// http://vincit.github.io/objection.js/

import { Model } from "objection";
import db from "../db.js";
import { convertBoolFieldsToInt, convertIntFieldsToBool } from "../lib/helpers.js";
import ClientCertificate from "./client_certificate.js";
import now from "./now_helper.js";
import User from "./user.js";

Model.knex(db());

const boolFields = ["is_deleted"];

class ClientCa extends Model {
	$beforeInsert() {
		this.created_on = now();
		this.modified_on = now();

		// Default for meta
		if (typeof this.meta === "undefined") {
			this.meta = {};
		}
	}

	$beforeUpdate() {
		this.modified_on = now();
	}

	$parseDatabaseJson(json) {
		const thisJson = super.$parseDatabaseJson(json);
		// Postgres returns COUNT() as a string
		if (typeof thisJson.client_certificate_count === "string") {
			thisJson.client_certificate_count = Number.parseInt(thisJson.client_certificate_count, 10);
		}
		return convertIntFieldsToBool(thisJson, boolFields);
	}

	$formatDatabaseJson(json) {
		const thisJson = convertBoolFieldsToInt(json, boolFields);
		return super.$formatDatabaseJson(thisJson);
	}

	static get name() {
		return "ClientCa";
	}

	static get tableName() {
		return "client_ca";
	}

	static get jsonAttributes() {
		return ["meta"];
	}

	static get relationMappings() {
		return {
			owner: {
				relation: Model.HasOneRelation,
				modelClass: User,
				join: {
					from: "client_ca.owner_user_id",
					to: "user.id",
				},
				modify: (qb) => {
					qb.where("user.is_deleted", 0);
				},
			},
			certificates: {
				relation: Model.HasManyRelation,
				modelClass: ClientCertificate,
				join: {
					from: "client_ca.id",
					to: "client_certificate.client_ca_id",
				},
				modify: (qb) => {
					qb.where("client_certificate.is_deleted", 0);
				},
			},
		};
	}
}

export default ClientCa;

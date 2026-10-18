import { migrate as logger } from "../logger.js";

const migrateName = "client_ca";

/**
 * Migrate
 *
 * Adds Client Certificate Authorities, the Client Certificates they issue
 * and the link between Access Lists and the CAs they trust for mTLS.
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.createTable("client_ca", (table) => {
			table.increments().primary();
			table.dateTime("created_on").notNull();
			table.dateTime("modified_on").notNull();
			table.integer("owner_user_id").notNull().unsigned();
			table.integer("is_deleted").notNull().unsigned().defaultTo(0);
			table.string("name").notNull();
			table.integer("validity_days").notNull().unsigned();
			table.dateTime("expires_on").notNull();
			table.integer("crl_number").notNull().unsigned().defaultTo(0);
			table.dateTime("crl_next_update").nullable();
			table.json("meta").notNull();
		})
		.then(() => {
			logger.info(`[${migrateName}] client_ca Table created`);

			return knex.schema.createTable("client_certificate", (table) => {
				table.increments().primary();
				table.dateTime("created_on").notNull();
				table.dateTime("modified_on").notNull();
				table.integer("owner_user_id").notNull().unsigned();
				table.integer("client_ca_id").notNull().unsigned();
				table.integer("is_deleted").notNull().unsigned().defaultTo(0);
				table.string("name").notNull();
				table.string("serial").notNull();
				table.dateTime("expires_on").notNull();
				table.integer("revoked").notNull().unsigned().defaultTo(0);
				table.dateTime("revoked_on").nullable();
				table.json("meta").notNull();
				table.index("client_ca_id");
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] client_certificate Table created`);

			return knex.schema.createTable("access_list_client_ca", (table) => {
				table.increments().primary();
				table.integer("access_list_id").notNull().unsigned();
				table.integer("client_ca_id").notNull().unsigned();
				table.unique(["access_list_id", "client_ca_id"]);
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] access_list_client_ca Table created`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.dropTable("access_list_client_ca")
		.then(() => knex.schema.dropTable("client_certificate"))
		.then(() => knex.schema.dropTable("client_ca"))
		.then(() => {
			logger.info(`[${migrateName}] client_ca Tables dropped`);
		});
};

export { up, down };

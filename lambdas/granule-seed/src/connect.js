// @ts-check

'use strict';

const isFunction = require('lodash/isFunction');
const isString = require('lodash/isString');
const { Client } = require('pg');
const { getKnexConfig } = require('@cumulus/db');

/**
 * @typedef {import('pg').ClientConfig} ClientConfig
 */

/**
 * Resolve a node-postgres connection config using Cumulus's own resolution rules.
 *
 * Delegates to `getKnexConfig` so that Secrets Manager (`databaseCredentialSecretArn`),
 * the `PG_*` environment fallback, and the SSL/`rejectUnauthorized` handling are not
 * reimplemented here. The resulting object is shape-compatible with `pg.Client`.
 *
 * @param {object} params
 * @param {NodeJS.ProcessEnv} [params.env]
 * @returns {Promise<ClientConfig>}
 */
const getPgConnectionConfig = async ({ env = process.env } = {}) => {
  const knexConfig = await getKnexConfig({ env });
  const connection = knexConfig.connection;

  if (!connection || isString(connection) || isFunction(connection)) {
    throw new TypeError('Expected getKnexConfig to resolve a connection config object');
  }

  return /** @type {ClientConfig} */ (connection);
};

/**
 * Run `fn` against a dedicated `pg.Client`.
 *
 * A raw client is used rather than a knex connection for two reasons: COPY needs the
 * underlying socket, and it keeps bulk rows out of knex's `postProcessResponse`, which
 * coerces `*cumulus_id` columns to Number and throws above `Number.MAX_SAFE_INTEGER`.
 *
 * Both timeouts are disabled because a single COPY over a large table legitimately runs
 * for hours, and the extractor holds one transaction open across every tier.
 *
 * @param {object} params
 * @param {NodeJS.ProcessEnv} [params.env]
 * @param {string} [params.applicationName] - surfaces in `pg_stat_activity`
 * @param {(client: import('pg').Client) => Promise<any>} fn
 * @returns {Promise<any>}
 */
const withPgClient = async (params, fn) => {
  const { env = process.env, applicationName = 'cumulus-granule-seed' } = params;
  const connection = await getPgConnectionConfig({ env });

  const client = new Client({ ...connection, application_name: applicationName });
  await client.connect();

  try {
    await client.query('SET statement_timeout = 0');
    await client.query('SET idle_in_transaction_session_timeout = 0');
    return await fn(client);
  } finally {
    await client.end();
  }
};

module.exports = {
  getPgConnectionConfig,
  withPgClient,
};

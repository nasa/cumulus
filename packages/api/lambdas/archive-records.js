'use-strict';

const range = require('lodash/range');
const moment = require('moment');
const { GranulePgModel, ExecutionPgModel } = require('@cumulus/db');
const { log } = require('@cumulus/common');
const { getKnexClient } = require('@cumulus/db');

/**
 * @typedef {'granules' | 'executions' | both } RecordTypes
 */
/**
 * @typedef {Object} EventConfig
 * @property {number | undefined} updateLimit
 * @property {number | undefined} batchSize
 * @property {number | undefined} expirationDays
 * @property {RecordTypes | undefined} recordType
 */
/**
 * @typedef {Object} Event
 * @property {EventConfig | undefined} config
 */

/**
 * @typedef {Object} MassagedEventConfig
 * @property {number} updateLimit
 * @property {number} batchSize
 * @property {number} expirationDays
 * @property {RecordTypes} recordType
 */

/**
 * Parse config, and fill with defaults as necessary
 * @param {EventConfig | undefined} config
 * @returns {MassagedEventConfig} config
 *   that has been validated and filled with defaults as necessary
 */
function getParsedConfigValues(config) {
  let recordType = 'both';
  if (config?.recordType && ['granules', 'executions', 'both'].includes(config.recordType)) {
    recordType = config.recordType;
  } else {
    log.warn(`unrecognized recordType requested, expected "granules", "executions", or "both", got ${config?.recordType}, running both`);
  }
  const updateLimit = config?.updateLimit || Number(process.env.UPDATE_LIMIT) || 10000;
  const batchSize = config?.batchSize || Number(process.env.BATCH_SIZE) || 1000;
  const expirationDays = config?.expirationDays || Number(process.env.EXPIRATION_DAYS) || 365;
  if (updateLimit <= 0) {
    throw new Error(`updateLimit must be a positive number greater than 0, got ${updateLimit}`);
  }
  if (batchSize <= 0) {
    throw new Error(`batchSize must be a positive number greater than 0, got ${batchSize}`);
  }
  if (expirationDays <= 0) {
    throw new Error(`expirationDays must be a positive number greater than 0, got ${expirationDays}`);
  }
  return {
    updateLimit,
    batchSize,
    expirationDays,
    recordType,
  };
}

/**
 * Performs granule update in batches in the database
 * @param {MassagedEventConfig} config
 * @returns {Promise<number>} number of records that have actually been updated
 */
const archiveGranules = async (config) => {
  if (config.recordType === 'executions') {
    return 0;
  }
  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = new Date(moment().subtract(expirationDays, 'd'));
  const granulePgModel = new GranulePgModel();
  const knex = await getKnexClient();
  for (const i of range(updateLimit / batchSize)) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await granulePgModel.bulkArchive(
      knex,
      {
        limit: Math.min(batchSize, updateLimit - (i * batchSize)),
        expirationDate,
      }
    );
    totalUpdated += updated;
    if (!updated) {
      break;
    }
  }
  return totalUpdated;
};

/**
 * Performs execution update in batches in the database
 * @param {MassagedEventConfig} config
 * @returns {Promise<number>} number of records that have actually been updated
 */
const archiveExecutions = async (config) => {
  if (config.recordType === 'granules') {
    return 0;
  }

  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = new Date(moment().subtract(expirationDays, 'd'));
  const knex = await getKnexClient();
  const executionPgModel = new ExecutionPgModel();
  for (const i of range(updateLimit / batchSize)) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await executionPgModel.bulkArchive(
      knex,
      {
        limit: Math.min(batchSize, updateLimit - (i * batchSize)),
        expirationDate,
      }
    );
    totalUpdated += updated;
    if (!updated) {
      break;
    }
  }
  return totalUpdated;
};

/**
 * Lambda handler to wrap all functionality
 * @param {Event} event
 * @returns {Promise<{granulesUpdated: number, executionsUpdated: number}>} object
 *   containing number of records updated
 */
async function handler(event) {
  const config = await getParsedConfigValues(event.config);
  log.info('running archive-records with config', JSON.stringify(config));
  const [granulesUpdated, executionsUpdated] = await Promise.all([
    archiveGranules(config),
    archiveExecutions(config),
  ]);
  return {
    granulesUpdated,
    executionsUpdated,
  };
}

exports.handler = handler;
exports.getParsedConfigValues = getParsedConfigValues;

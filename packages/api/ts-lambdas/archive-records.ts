'use-strict';

import range from 'lodash/range';
import moment from 'moment';
import { GranulePgModel, ExecutionPgModel, getKnexClient } from '@cumulus/db';
import { log } from '@cumulus/common';
import { Message } from '@cumulus/types';

type ArchiveRecordsEvent = {
  config?: EventConfig;
};

type ArchiveRecordTypes = Exclude<Message.RecordType, 'pdr'>
type EventConfig = {
  updateLimit?: number;
  batchSize?: number;
  expirationDays?: number;
  recordTypes?: string;
};

type MassagedEventConfig = {
  updateLimit: number;
  batchSize: number;
  expirationDays: number;
  recordTypes: ArchiveRecordTypes[];
};
function getParsedConfigValues(config: EventConfig | undefined): MassagedEventConfig {
  let recordTypes: ArchiveRecordTypes[];
  if(!config?.recordTypes) {
    log.warn('no recordType specified, in config, doing granules and executions')
    recordTypes = ['granule', 'execution'];
  } else {
    const unMassagedRecordTypes = config.recordTypes.split(',');
    recordTypes = unMassagedRecordTypes.map((recordTypeString) => {
      if (['granule', 'execution'].includes(recordTypeString)){
        return recordTypeString;
      }
      else {
        log.warn(`unrecognized recordType requested, expected "granule" or "execution", got ${recordTypeString}, skipping`);
        return ""
      }
      
    }).filter(Boolean) as ArchiveRecordTypes[];
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
    recordTypes,
  };
}

/**
 * Performs granule update in batches in the database
 * @param config
 * @returns number of records that have actually been updated
 */
const archiveGranules = async (config: MassagedEventConfig): Promise<number> => {
  if (!config.recordTypes.includes('granule')) {
    return 0;
  }
  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = moment().subtract(expirationDays, 'd').toDate().toISOString();
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
 * @param config
 * @returns number of records that have actually been updated
 */
const archiveExecutions = async (config: MassagedEventConfig): Promise<number> => {
  if (!config.recordTypes.includes('execution')) {
    return 0;
  }
  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = moment().subtract(expirationDays, 'd').toDate().toISOString();
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
 * @param event
 * @returns object
 *   containing number of records updated
 */
async function handler(event: ArchiveRecordsEvent) {
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

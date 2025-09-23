'use-strict';

import range from 'lodash/range';
import moment from 'moment';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { GranulePgModel, ExecutionPgModel } from '@cumulus/db';
import { log } from '@cumulus/common';
import { getKnexClient } from '@cumulus/db';
type Event = {
  config?: EventConfig;
};

type TestMethods = {
  archiveGranulesMethod: (params: {
    prefix: string,
    body: {
      batchSize?: number,
      expirationDays?: number
    }
  }) => Promise<ApiGatewayLambdaHttpProxyResponse>,
  archiveExecutionsMethod: (params: {
    prefix: string,
    body: {
      batchSize?: number,
      expirationDays?: number
    }
  }) => Promise<ApiGatewayLambdaHttpProxyResponse>,
};
type RecordTypes = 'granules' | 'executions' | 'both';
type EventConfig = {
  updateLimit?: number;
  batchSize?: number;
  expirationDays?: number;
  recordType?: string;
  testMethods?: TestMethods;
};

type MassagedEventConfig = {
  updateLimit: number;
  batchSize: number;
  expirationDays: number;
  recordType: RecordTypes;
} & EventConfig;
export function getParsedConfigValues(config: EventConfig | undefined): MassagedEventConfig {
  let recordType: RecordTypes = 'both';
  if (config?.recordType && ['granules', 'executions', 'both'].includes(config.recordType)) {
    recordType = config.recordType as RecordTypes;
  } else {
    log.warn(`unrecognized recordType requested, expected "granules", "executions", or "both", got ${config?.recordType}, running both`);
  }
  return {
    updateLimit: config?.updateLimit || Number(process.env.UPDATE_LIMIT) || 10000,
    batchSize: config?.batchSize || Number(process.env.BATCH_SIZE) || 1000,
    expirationDays: config?.expirationDays || Number(process.env.EXPIRATION_DAYS) || 365,
    recordType,
    testMethods: config?.testMethods,
  };
}

const archiveGranules = async (config: MassagedEventConfig) => {
  if (config.recordType === 'executions') {
    return 0;
  }
  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = moment().subtract(expirationDays, 'd').format('YYYY-MM-DD');
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
const archiveExecutions = async (config: MassagedEventConfig) => {
  if (config.recordType === 'granules') {
    return 0;
  }

  const { batchSize, updateLimit, expirationDays } = config;
  let totalUpdated = 0;
  const expirationDate = moment().subtract(expirationDays, 'd').format('YYYY-MM-DD');
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
const archiveRecords = async (event: Event) => {
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
};

/**
 * Lambda handler
 */
/* istanbul ignore next */
async function handler(event: Event): Promise<Object> {
  return await archiveRecords(event);
}

exports.handler = handler;

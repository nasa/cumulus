'use-strict';

import { bulkArchiveGranules } from '@cumulus/api-client/granules';
import { bulkArchiveExecutions } from '@cumulus/api-client/executions';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { log } from '@cumulus/common';
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
  batchSize?: number;
  expirationDays?: number;
  recordType?: string;
  testMethods?: TestMethods;
};

type MassagedEventConfig = {
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
    batchSize: config?.batchSize || Number(process.env.BATCH_SIZE) || 10000,
    expirationDays: config?.expirationDays || Number(process.env.EXPIRATION_DAYS) || 365,
    recordType,
    testMethods: config?.testMethods,
  };
}

const archiveRecords = async (event: Event) => {
  const config = await getParsedConfigValues(event.config);
  log.info('running archive-records with config', JSON.stringify(config));
  const archiveGranulesMethod = config.testMethods?.archiveGranulesMethod || bulkArchiveGranules;
  const archiveExecutionsMethod = config.testMethods?.archiveExecutionsMethod
    || bulkArchiveExecutions;
  const output: {
    granulesUpdated?: string,
    executionsUpdated?: string,
  } = {};
  if (config.recordType === 'both' || config.recordType === 'executions') {
    const archiveOutput = await archiveExecutionsMethod({
      prefix: getRequiredEnvVar('stackName'),
      body: config,
    });
    output.granulesUpdated = JSON.parse(archiveOutput.body).recordsUpdated;
  }
  if (config.recordType === 'both' || config.recordType === 'granules') {
    const archiveOutput = await archiveGranulesMethod({
      prefix: getRequiredEnvVar('stackName'),
      body: config,
    });
    output.executionsUpdated = JSON.parse(archiveOutput.body).recordsUpdated;
  }
  return output;
};

/**
 * Lambda handler
 */
/* istanbul ignore next */
async function handler(event: Event): Promise<Object> {
  return await archiveRecords(event);
}

exports.handler = handler;

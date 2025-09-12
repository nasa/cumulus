'use-strict';

import { bulkPatchGranuleArchived, listGranules } from '@cumulus/api-client/granules';
import { bulkArchiveExecutions } from '@cumulus/api-client/executions';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { log } from '@cumulus/common';
import { ApiGranuleRecord } from '@cumulus/types';
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
  listGranulesMethod: (params: {
    prefix: string,
    body: {
      limit: number,
      archived: boolean,
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

type EventConfig = {
  batchSize?: number;
  expirationDays?: number;
  testMethods?: TestMethods;
};

type MassagedEventConfig = {
  batchSize: number;
  expirationDays: number;
} & EventConfig;
export function getParsedConfigValues(config: EventConfig | undefined): MassagedEventConfig {
  return {
    batchSize: config?.batchSize || Number(process.env.BATCH_SIZE) || 10000,
    expirationDays: config?.expirationDays || Number(process.env.EXPIRATION_DAYS) || 365,
    testMethods: config?.testMethods,
  };
}

const archiveGranulesBatch = async (config: MassagedEventConfig) => {
  const archiveGranulesMethod = config.testMethods?.archiveGranulesMethod || bulkPatchGranuleArchived;
  // const listGranulesMethod = config.testMethods?.listGranulesMethod || listGranules;
  const listGranulesResponse = await listGranules({
    prefix: getRequiredEnvVar('stackName'),
    query: {
      limit: String(config.batchSize),
      archived: 'false'
    }
  })
  const granules = JSON.parse(listGranulesResponse.body) as Array<ApiGranuleRecord>;
  console.log(granules)
  const granuleIds = granules.map((granule) => granule.granuleId);
  return archiveGranulesMethod({
    prefix: getRequiredEnvVar('stackName'),
    body: {
      granuleIds,
      archived: true
    }
  })
}

const archiveRecords = async (event: Event) => {
  const config = await getParsedConfigValues(event.config);
  log.info('running archive-records with config', JSON.stringify(config));
  const archiveExecutionsMethod = config.testMethods?.archiveExecutionsMethod
    || bulkArchiveExecutions;
  const [granulesOutput, executionsOutput] = await Promise.all([
    archiveGranulesBatch(config),
    archiveExecutionsMethod({
      prefix: getRequiredEnvVar('stackName'),
      body: config,
    }),
  ]);
  return {
    granulesUpdated: JSON.parse(granulesOutput.body).recordsUpdated,
    executionsUpdated: JSON.parse(executionsOutput.body).recordsUpdated,
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

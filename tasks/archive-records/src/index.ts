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
      updateLimit?: number,
      expirationDays?: number
    }
  }) => Promise<ApiGatewayLambdaHttpProxyResponse>,
  archiveExecutionsMethod: (params: {
    prefix: string,
    body: {
      updateLimit?: number,
      expirationDays?: number
    }
  }) => Promise<ApiGatewayLambdaHttpProxyResponse>,
};

type EventConfig = {
  updateLimit?: number;
  expirationDays?: number;
  testMethods?: TestMethods;
};

type MassagedEventConfig = {
  batchSize: number;
  expirationDays: number;
} & EventConfig;
function getParsedConfigValues(config: EventConfig | undefined): MassagedEventConfig {
  return {
    batchSize: config?.updateLimit || Number(process.env.UPDATE_LIMIT) || 10000,
    expirationDays: config?.expirationDays || Number(process.env.EXPIRATION_DAYS) || 365,
    testMethods: config?.testMethods,
  };
}

const archiveRecords = async (event: Event) => {
  const config = await getParsedConfigValues(event.config);
  log.info('running archive-records with config', JSON.stringify(config));
  const archiveGranulesMethod = config.testMethods?.archiveGranulesMethod || bulkArchiveGranules;
  await archiveGranulesMethod({
    prefix: getRequiredEnvVar('stackName'),
    body: config,
  });
  const archiveExecutionsMethod = config.testMethods?.archiveExecutionsMethod
    || bulkArchiveExecutions;
  await Promise.all([
    archiveGranulesMethod({
      prefix: getRequiredEnvVar('stackName'),
      body: config,
    }),
    archiveExecutionsMethod({
      prefix: getRequiredEnvVar('stackName'),
      body: config,
    }),
  ]);
  return { message: 'yay' };
};

/**
 * Lambda handler
 */
/* istanbul ignore next */
async function handler(event: Event): Promise<Object> {
  return await archiveRecords(event);
}

exports.handler = handler;

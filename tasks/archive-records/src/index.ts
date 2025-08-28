'use-strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { CumulusMessage } from '@cumulus/types/message';
import { bulkArchiveGranules } from '@cumulus/api-client/granules';
import { bulkArchiveExecutions } from '@cumulus/api-client/executions';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { getRequiredEnvVar } from '@cumulus/common/env';

type Event = {
  config: EventConfig;
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

type EventConfig = {
  batchSize?: number;
  expirationDays?: number;
  testMethods?: TestMethods;
};

type MassagedEventConfig = {
  batchSize: number;
  expirationDays: number;
} & EventConfig;
function getParsedConfigValues(config: EventConfig): MassagedEventConfig {
  return {
    batchSize: config.batchSize || 10000,
    expirationDays: config.expirationDays || 365,
    testMethods: config.testMethods,
  };
}

const archiveRecords = async (event: Event) => {
  const config = await getParsedConfigValues(event.config);
  const archiveGranulesMethod = config.testMethods?.archiveGranulesMethod || bulkArchiveGranules
  await archiveGranulesMethod({
    prefix: getRequiredEnvVar('prefix'),
    body: config
  });
  const archiveExecutionsMethod = config.testMethods?.archiveExecutionsMethod || bulkArchiveExecutions
  await Promise.all([
    archiveGranulesMethod({
      prefix: getRequiredEnvVar('prefix'),
      body: config
    }),
    archiveExecutionsMethod({
      prefix: getRequiredEnvVar('prefix'),
      body: config
    }),
  ]);
  
  return { message: 'yay' };
}

/**
 * Lambda handler
 */
/* istanbul ignore next */
async function handler(event: CumulusMessage, context: Context): Promise<Object> {
  return await runCumulusTask(archiveRecords, event, context);
}

exports.handler = handler;
'use-strict';

import { Context } from 'aws-lambda';
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { CumulusMessage } from '@cumulus/types/message';
import { listGranules } from '@cumulus/api-client/granules';
import { ApiGatewayLambdaHttpProxyResponse } from '@cumulus/api-client/types';
import { getRequiredEnvVar } from '@cumulus/common/env';

type Event = {
  config: EventConfig
}

type TestMethods = {
  listGranulesMethod: (params: Object) => Promise<ApiGatewayLambdaHttpProxyResponse>,
};

type EventConfig = {
  testMethods?: TestMethods
}
type MassagedEventConfig = {
} & EventConfig;
function getParsedConfigValues(config: EventConfig): MassagedEventConfig {
  return config;
}

const getGranulesList = async (
  config: EventConfig
) => {
  const listGranulesMethod = config.testMethods?.listGranulesMethod || listGranules;
  const granulesResponse = await listGranulesMethod({
    prefix: getRequiredEnvVar('stackName'),
    query: {
      archived: false,
      // limit: granuleIds.length.toString(), // change this to a configurable value
    },
  });
  return JSON.parse(granulesResponse.body).results;
}
const archiveRecords = async (event: Event) => {
  const config = await getParsedConfigValues(event.config);
  getGranulesList(config);
  return {};
}

/**
 * Lambda handler
 */
/* istanbul ignore next */
async function handler(event: CumulusMessage, context: Context): Promise<Object> {
  return await runCumulusTask(archiveRecords, event, context);
}

exports.handler = handler;
import { lambda } from '@cumulus/aws-client/services';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

export type EmsReportType = 'distribution' | 'ingest' | 'metadata';

export interface CreateEmsReportsRequest {
  reportType: EmsReportType,
  startTime: string,
  endTime: string,
  collectionId: string
}

/**
 * Fetch deployment's `ems_*` environment variables.
 *
 * @param {string} lambdaName - deployment prefix
 * @returns {Promise<Object>} map of ems_* lambda envs
 */
export async function getLambdaEmsSettings(
  lambdaName: string
): Promise<{[key: string]: string}> {
  const config = await lambda().getFunctionConfiguration(
    { FunctionName: lambdaName }
  ).promise();

  const variables = config?.Environment?.Variables ?? {};

  const shortEmsEntries = Object.entries(variables)
    .filter(([key]) => key.startsWith('ems_'))
    .map(([key, value]) => [key.replace(/^ems_/, ''), value]);

  return Object.fromEntries(shortEmsEntries);
}

/**
 * Post a request to the ems API
 * POST /ems
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.request    - request body to post
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                   that takes a prefix / user payload.  Defaults
 *                                   to cumulusApiClient.invokeApifunction to invoke the api lambda
 * @returns {Promise<Object>}        - promise that resolves to the output of the API lambda
 */
export async function createEmsReports(params: {
  prefix: string,
  request: CreateEmsReportsRequest,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> {
  const { prefix, request, callback = invokeApi } = params;

  return callback({
    prefix: prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/ems',
      body: JSON.stringify(request),
    },
  });
}

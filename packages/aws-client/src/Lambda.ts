/**
 * @module Lambda
 */
import { InvocationType } from '@aws-sdk/client-lambda';
import Logger from '@cumulus/logger';
import { lambda } from './services';
import { inTestMode } from './test-utils';

const log = new Logger({ sender: 'aws-client/Lambda' });

/**
 * Invoke a Lambda function
 *
 * @param {string} name - Lambda function name
 * @param {any} payload - the payload to the Lambda function
 * @param {string} type - the invocation type
 * @returns {Promise<InvokeCommandOutput>}
 * @alias module:Lambda.invoke
 */
export const invoke = async (name: string, payload: unknown, type: InvocationType = 'Event') => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);

    return false;
  }

  log.info(`Invoking ${name}`);

  let response;
  try {
    response = await lambda().invoke({
      FunctionName: name,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
      InvocationType: type,
    });
  } catch (error) {
    log.error(`Error invoking ${name}`, error);
    throw error;
  }
  return response;
};

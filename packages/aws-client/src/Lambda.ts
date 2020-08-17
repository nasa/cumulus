/**
 * @module Lambda
 */

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
 * @returns {Promise<AWS.Lambda.InvocationResponse>}
 *
 * @alias module:Lambda.invoke
 */
export const invoke = async (name: string, payload: unknown, type = 'Event') => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);

    return false;
  }

  log.info(`Invoking ${name}`);

  return lambda().invoke({
    FunctionName: name,
    Payload: JSON.stringify(payload),
    InvocationType: type,
  }).promise();
};

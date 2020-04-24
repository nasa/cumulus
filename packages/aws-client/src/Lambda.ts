import Logger = require('@cumulus/logger');
import { lambda } from './services';
import { inTestMode } from './test-utils';

const log = new Logger({ sender: 'aws-client/Lambda' });

export const invoke = async (name: string, payload: unknown, type = 'Event') => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);

    return false;
  }

  log.info(`Invoking ${name}`);

  return lambda().invoke({
    FunctionName: name,
    Payload: JSON.stringify(payload),
    InvocationType: type
  }).promise();
};

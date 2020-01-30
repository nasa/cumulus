const Logger = require('@cumulus/logger');

const awsServices = require('./services');
const { inTestMode } = require('./test-utils');

const log = new Logger({ sender: 'aws-client/Lambda' });

const invoke = async (name, payload, type = 'Event') => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);
    return false;
  }

  const params = {
    FunctionName: name,
    Payload: JSON.stringify(payload),
    InvocationType: type
  };

  log.info(`invoked ${name}`);
  return awsServices.lambda().invoke(params).promise();
};

module.exports = {
  invoke
};

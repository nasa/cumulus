'use strict';

const { lambda } = require('@cumulus/aws-client/services');

async function invokeStartAsyncOperationLambda(event) {
  if (!process.env.StartAsyncOperationLambda) {
    throw new Error('The StartAsyncOperationLambda environment variable is not set.');
  }

  await lambda().invoke({
    FunctionName: process.env.StartAsyncOperationLambda,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
    InvocationType: 'Event',
  });
}
module.exports = {
  invokeStartAsyncOperationLambda,
};

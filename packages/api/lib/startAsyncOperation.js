'use strict';

const { lambda } = require('@cumulus/aws-client/services');
const {
  InvokeCommand,
} = require('@aws-sdk/client-lambda');

async function invokeStartAsyncOperationLambda(event) {
  if (!process.env.StartAsyncOperationLambda) {
    throw new Error('The StartAsyncOperationLambda environment variable is not set.');
  }

  await lambda().send(new InvokeCommand({
    FunctionName: process.env.StartAsyncOperationLambda,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
    InvocationType: 'Event',
  }));
}
module.exports = {
  invokeStartAsyncOperationLambda,
};

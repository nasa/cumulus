'use strict';

const aws = require('./aws');

const describeExecution = aws.retryOnThrottlingException(
  (params) => aws.sfn().describeExecution(params).promise()
);

const describeStateMachine = aws.retryOnThrottlingException(
  (params) => aws.sfn().describeStateMachine(params).promise()
);

const executionExists = async (executionArn) => {
  try {
    await describeExecution({ executionArn });
    return true;
  }
  catch (err) {
    if (err.code === 'ExecutionDoesNotExist') return false;
    throw err;
  }
};

const getExecutionHistory = aws.retryOnThrottlingException(
  (params) => aws.sfn().getExecutionHistory(params).promise()
);

const listExecutions = aws.retryOnThrottlingException(
  (params) => aws.sfn().listExecutions(params).promise()
);

module.exports = {
  describeExecution,
  describeStateMachine,
  executionExists,
  getExecutionHistory,
  listExecutions
};

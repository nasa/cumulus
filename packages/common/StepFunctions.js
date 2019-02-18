'use strict';

const aws = require('./aws');

// Utility functions

const doesExecutionExist = (describeExecutionPromise) =>
  describeExecutionPromise
    .then(() => true)
    .catch((err) => {
      if (err.code === 'ExecutionDoesNotExist') return false;
      throw err;
    });

// Exported functions

const describeExecution = aws.retryOnThrottlingException(
  (params) => aws.sfn().describeExecution(params).promise()
);

const describeStateMachine = aws.retryOnThrottlingException(
  (params) => aws.sfn().describeStateMachine(params).promise()
);

const executionExists = (executionArn) =>
  doesExecutionExist(describeExecution({ executionArn }));

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
  listExecutions,

  // Not part of the public API, exported for testing
  doesExecutionExist
};

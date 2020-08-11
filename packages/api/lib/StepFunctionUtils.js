'use strict';

const getExecutionUrl = (executionArn) => {
  const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';

  return `https://console.aws.amazon.com/states/home?region=${region}#/executions/details/${executionArn}`;
};

module.exports = {
  getExecutionUrl,
};

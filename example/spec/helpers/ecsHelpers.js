'use strict';

const { ecs } = require('@cumulus/aws-client/services');

async function findAsyncOperationTaskDefinitionForDeployment(stackName) {
  let taskDefinitionArn;
  let nextToken;

  do {
    const params = {
      familyPrefix: `${stackName}-AsyncOperationTaskDefinition`,
      nextToken,
      sort: 'ASC',
    };
    // eslint-disable-next-line no-await-in-loop
    const response = await ecs().listTaskDefinitions(params);
    nextToken = response.nextToken;
    const taskDefinitionArns = response.taskDefinitionArns;
    taskDefinitionArn = taskDefinitionArns[taskDefinitionArns.length - 1];
  } while (nextToken && !taskDefinitionArn);
  if (!taskDefinitionArn) throw new Error(`No AsyncOperation task definition ARN found for deployment ${stackName}`);
  return (taskDefinitionArn);
}

module.exports = {
  findAsyncOperationTaskDefinitionForDeployment,
};

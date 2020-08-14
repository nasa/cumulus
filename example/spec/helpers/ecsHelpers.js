'use strict';

const { ecs } = require('@cumulus/aws-client/services');

async function findAsyncOperationTaskDefinitionForDeployment(stackName) {
  let taskDefinitionArn;
  let nextToken;

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await ecs().listTaskDefinitions({ nextToken }).promise();
    nextToken = response.nextToken;
    const taskDefinitionArns = response.taskDefinitionArns;
    taskDefinitionArn = taskDefinitionArns.find(
      (arn) => arn.includes(`${stackName}-AsyncOperationTaskDefinition`)
    );
  } while (nextToken && !taskDefinitionArn);
  if (!taskDefinitionArn) throw new Error(`No AsyncOperation task definition ARN found for deployment ${stackName}`);
  return (taskDefinitionArn);
}

module.exports = {
  findAsyncOperationTaskDefinitionForDeployment,
};

'use strict';

/**
 * Provides status of services running in AWS EC2 Container Service.
 */

/*eslint no-console: ["error", { allow: ["error"] }] */
const { ecs, cf } = require('./aws');
const { fromJS } = require('immutable');

/**
 * TODO
 */
const getStackResources = async (stackName) => {
  const resp = fromJS(await cf().describeStackResources({ StackName: stackName }).promise());
  return resp.get('StackResources').groupBy(m => m.get('LogicalResourceId')).map(v => v.first());
};

/**
 * TODO
 */
const getIngestStackResources = async (mainStackResources) => {
  const arn = mainStackResources.getIn(['IngestStack', 'PhysicalResourceId']);
  const ingestStackName = arn.split('/')[1];
  return getStackResources(ingestStackName);
};

// TODO make the service names a constant.
// Put this on the API.
//
// TODO design what this will look like in HTML

/**
 * TODO
 */
const getIngestServiceStatus = async (stackName, serviceNames) => {
  const mainStackResources = await getStackResources(stackName);
  const ingestStackResources = await getIngestStackResources(mainStackResources);

  const clusterId = ingestStackResources.getIn(['IngestECSCluster', 'PhysicalResourceId']);

  return Promise.all(serviceNames.map(async (serviceName) => {
    const physicalId = ingestStackResources.getIn([`${serviceName}Service`, 'PhysicalResourceId']);
    const id = physicalId.split('/')[1];
    const taskListResp = await ecs().listTasks({
      cluster: clusterId,
      serviceName: id
    }).promise();
    const taskDescriptions = await ecs().describeTasks({
      cluster: clusterId,
      tasks: taskListResp.taskArns
    }).promise();
    return {
      serviceName: serviceName,
      tasks: taskDescriptions.tasks.map(taskDesc => ({
        status: taskDesc.lastStatus, // TODO or return running: true/false
        startedAt: taskDesc.startedAt,
        stoppedReason: taskDesc.stoppedReason
      }))
    };
  }));
};

// printPromise(getIngestServiceStatus('gitc-jg', ['GenerateMrf', 'SfnScheduler']))

// [
//   {
//     "serviceName": "GenerateMrf",
//     "tasks": [
//       {
//         "status": "RUNNING",
//         "startedAt": "2017-05-21T22:10:48.327Z"
//       },
//       {
//         "status": "RUNNING",
//         "startedAt": "2017-05-21T22:10:48.310Z"
//       }
//     ]
//   },
//   {
//     "serviceName": "SfnScheduler",
//     "tasks": [
//       {
//         "status": "RUNNING",
//         "startedAt": "2017-05-21T10:31:26.417Z"
//       }
//     ]
//   }
// ]
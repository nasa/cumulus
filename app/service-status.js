'use strict';

/**
 * Provides status of services running in AWS EC2 Container Service.
 */

/*eslint no-console: ["error", { allow: ["error"] }] */
const { handleError } = require('./api-errors');
const { ecs, cf } = require('./aws');
const { fromJS } = require('immutable');

const INGEST_SERVICE_NAMES = ['GenerateMrf', 'SfnScheduler'];
const ON_EARTH_SERVICE_NAME = 'OnEarth';

/**
 * TODO
 */
const arnToName = (arnMaybe) => {
  if (arnMaybe.startsWith('arn:')) {
    return arnMaybe.split('/')[1];
  }
  return arnMaybe;
};

/**
 * TODO
 */
const getStackResources = async (arnOrStackName) => {
  const stackName = arnToName(arnOrStackName);
  const resp = fromJS(await cf().describeStackResources({ StackName: stackName }).promise());
  return resp.get('StackResources').groupBy(m => m.get('LogicalResourceId')).map(v => v.first());
};

// TODO fetching all the stack resources and ids for things is slow. Add memoization to speed up
// performance. We can cache cluster ids potentially to reduce the lookup time.
// Once a task stops it can't be started again. We could cache the task ARN to task information.
// We're running in a lambda so it will keep it fresh for a little while.

/**
 * TODO
 */
const getRunningTasks = async (clusterId, serviceId) => {
  const taskListResp = await ecs().listTasks({
    cluster: clusterId,
    serviceName: serviceId
  }).promise();
  if (taskListResp.taskArns.length > 0) {
    const taskDescriptions = await ecs().describeTasks({
      cluster: clusterId,
      tasks: taskListResp.taskArns
    }).promise();
    // TODO update docs
    return taskDescriptions.tasks.map(taskDesc => ({
      startedAt: taskDesc.startedAt
    }));
  }
  //No running tasks found.
  return [];
};

/**
 * TODO
 */
const getServiceStatus = async (arnOrClusterId, serviceName, serviceId) => {
  const clusterId = arnToName(arnOrClusterId);
  const [serviceDesc, runningTasks] = await Promise.all([
    ecs().describeServices({
      cluster: clusterId,
      services: [serviceId]
    }).promise(),
    getRunningTasks(clusterId, serviceId)
  ]);
  return {
    serviceName: serviceName,
    desired_count: serviceDesc.services[0].desiredCount,
    running_tasks: runningTasks
  };
};

/**
 * TODO
 */
const getIngestServicesStatus = async (stackName) => {
  const mainStackResources = await getStackResources(stackName);
  const ingestStackResources = await getStackResources(
    mainStackResources.getIn(['IngestStack', 'PhysicalResourceId']));

  const clusterId = ingestStackResources.getIn(['IngestECSCluster', 'PhysicalResourceId']);

  return Promise.all(INGEST_SERVICE_NAMES.map(async (serviceName) => {
    const physicalId = ingestStackResources.getIn([`${serviceName}Service`, 'PhysicalResourceId']);
    return getServiceStatus(clusterId, serviceName, arnToName(physicalId));
  }));
};

/**
 * TODO
 */
const getOnEarthServiceStatus = async (stackName) => {
  const oeMainStackResources = await getStackResources(stackName);
  const oneEarthStackResources = await getStackResources(
    oeMainStackResources.getIn(['OnEarthStack', 'PhysicalResourceId'])
  );
  const [clusterStackResources, dockerStackResources] = await Promise.all([
    getStackResources(oneEarthStackResources.getIn(['Cluster', 'PhysicalResourceId'])),
    getStackResources(oneEarthStackResources.getIn(['OnearthDocker', 'PhysicalResourceId']))
  ]);

  const clusterId = clusterStackResources.getIn(['ECSCluster', 'PhysicalResourceId']);
  const serviceId = dockerStackResources.getIn(['Service', 'PhysicalResourceId']);
  return getServiceStatus(clusterId, ON_EARTH_SERVICE_NAME, serviceId);
};

/**
 * TODO
 */
const getServicesStatus = async (mainStackName, onEarthStackName) => {
  const [ingestServicesStatus, onEarthStatus] = await Promise.all([
    getIngestServicesStatus(mainStackName),
    getOnEarthServiceStatus(onEarthStackName)
  ]);
  ingestServicesStatus.push(onEarthStatus);
  return ingestServicesStatus;
};

/**
 * handleServiceStatusRequest - Handles the API request for service status.
 */
const handleServiceStatusRequest = async (req, res) => {
  try {
    req.checkQuery('main_stack_name', 'Invalid main_stack_name').notEmpty();
    req.checkQuery('on_earth_stack_name', 'Invalid on_earth_stack_name').notEmpty();
    const result = await req.getValidationResult();
    if (!result.isEmpty()) {
      res.status(400).json(result.array());
    }
    else {
      const mainStackName = req.query.main_stack_name;
      const onEarthStackName = req.query.on_earth_stack_name;
      const status = await getServicesStatus(mainStackName, onEarthStackName);
      res.json(status);
    }
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = { handleServiceStatusRequest };


// printPromise(getServicesStatus('gitc-jg','gibs-oe-jg'))

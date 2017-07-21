'use strict';

/**
 * Provides status of services running in AWS EC2 Container Service.
 */

/*eslint no-console: ["error", { allow: ["error"] }] */
const { handleError } = require('./api-errors');
const { ecs, dynamoDB } = require('./aws');
const { Map } = require('immutable');
const { loadCollectionConfig } = require('./collection-config');
const { getStackResources, getIngestStackResources, getPhysicalResourceId } =
  require('./stack-resources');
const rp = require('request-promise-native');

/**
 * Takes in what might be an ARN and if it is parses out the name. If it is not an ARN returns it
 * without changes.
 */
const arnToName = (arnMaybe) => {
  if (arnMaybe.startsWith('arn:')) {
    return arnMaybe.split('/')[1];
  }
  return arnMaybe;
};

/**
 * Returns a map of providers to maps containing the number of connections used and the provider
 * limit.
 */
const getCurrentUseConnections = async (mainStackName, ingestStackResources) => {
  // Performance optimization: If the config for providers has no limited connections then we don't
  // need to scan the table
  const connectsTable = getPhysicalResourceId(ingestStackResources, 'ConnectionsTable');

  const [collectionConfig, dbResult] = await Promise.all([
    loadCollectionConfig(mainStackName),
    dynamoDB().scan({ TableName: connectsTable }).promise()
  ]);
  const provUsedConns = dbResult.Items.reduce((m, { key, semvalue }) => (
    m.set(key, semvalue)
  ), Map());

  return collectionConfig.get('providers').reduce((m, provider) => {
    const id = provider.get('id');
    const config = provider.get('config');
    return m.set(id, Map({
      connection_limit: config.get('global_connection_limit', 'unlimited'),
      used: provUsedConns.get(id, 0)
    }));
  }, Map()).toJS();
};

// Potential performation optimization:
// Fetching all the stack resources and ids for things is slow. We could add memoization to speed up
// performance. We can cache cluster ids potentially to reduce the lookup time.
// Once a task stops it can't be started again. We could cache the task ARN to task information
// because the task start date will never change. This is all running in a lambda so caching in
// memory would only help while the lambda is up.

/**
 * Returns a list of the tasks that are running for the service.
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
    return taskDescriptions.tasks.map(taskDesc => ({
      started_at: taskDesc.startedAt
    }));
  }
  //No running tasks found.
  return [];
};

/**
 * Returns a map containing service status information for the service.
 */
const getServiceStatus = async (arnOrClusterId, humanServiceName, serviceId) => {
  const clusterId = arnToName(arnOrClusterId);
  const [serviceDesc, runningTasks] = await Promise.all([
    ecs().describeServices({
      cluster: clusterId,
      services: [serviceId]
    }).promise(),
    getRunningTasks(clusterId, serviceId)
  ]);
  const service = serviceDesc.services[0];
  return {
    service_name: humanServiceName,
    desired_count: service.desiredCount,
    actual_count: runningTasks.length,
    events: service.events.map(e => ({
      id: e.id,
      date: e.createdAt,
      message: e.message
    })),
    running_tasks: runningTasks
  };
};

const INGEST_SERVICE_NAMES = ['GenerateMrf', 'SfnScheduler'];

/**
 * Returns a list of service statuses for the services associated with ingest.
 */
const getIngestServicesStatus = async (ingestStackResources) => {
  const clusterId = getPhysicalResourceId(ingestStackResources, 'IngestECSCluster');

  return Promise.all(INGEST_SERVICE_NAMES.map(async (serviceName) => {
    const physicalId = getPhysicalResourceId(ingestStackResources, `${serviceName}Service`);
    return getServiceStatus(clusterId, serviceName, arnToName(physicalId));
  }));
};

const ON_EARTH_SERVICE_NAME = 'OnEarth';

/**
 * Returns the status of the OnEarth Service when deployed via NGAP
 */
const getOnEarthServiceStatusNgap = async (appName) => {
  const ngapApi = process.env.NGAP_API;
  if (!ngapApi) throw new Error('NGAP_API environment variable must be set');

  const ngapKey = process.env.NGAP_API_KEY;
  if (!ngapKey) throw new Error('NGAP_API_KEY environment variable must be set');

  const response = await rp({
    uri: `${ngapApi}/api/v1/apps/${appName}/processes`,
    headers: {
      Accept: 'application/json',
      Authorization: `Token token=${ngapKey}`
    },
    json: true
  });

  if (!response.success) throw new Error(`API Call failed: ${JSON.stringify(response)}`);
  let webProcess = null;
  for (const process of response.processes) {
    if (process.process_type === 'web') {
      webProcess = process;
      break;
    }
  }
  if (!webProcess) throw new Error(`No web process for OnEarth found: ${JSON.stringify(response)}`);

  return {
    service_name: ON_EARTH_SERVICE_NAME,
    desired_count: webProcess.desired_count,
    actual_count: webProcess.running_count,
    events: [], // Not available in NGAP
    running_tasks: [] // Not available in NGAP
  };
};

/**
 * Returns the status of the OnEarth Service when deployed via CloudFormation
 */
const getOnEarthServiceStatusCloudFormation = async (stackName) => {
  const oeMainStackResources = await getStackResources(stackName);
  const oneEarthStackResources = await getStackResources(
    getPhysicalResourceId(oeMainStackResources, 'OnEarthStack')
  );
  const [clusterStackResources, dockerStackResources] = await Promise.all([
    getStackResources(getPhysicalResourceId(oneEarthStackResources, 'Cluster')),
    getStackResources(getPhysicalResourceId(oneEarthStackResources, 'OnearthDocker'))
  ]);

  const clusterId = getPhysicalResourceId(clusterStackResources, 'ECSCluster');
  const serviceId = getPhysicalResourceId(dockerStackResources, 'Service');
  return getServiceStatus(clusterId, ON_EARTH_SERVICE_NAME, serviceId);
};

/**
 * Returns the status of the OnEarth Service
 */
const getOnEarthServiceStatus = async (stackName) => {
  // Check if an NGAP app name for OnEarth is in the environment, if so, query that.
  // For a successful NGAP query, we need three environment variables:
  //   NGAP_API - The NGAP API endpoint, e.g. https://ngap.ecs.earthdata.nasa.gov
  //   NGAP_API_KEY - A key authorized to communicate with the API for the OnEarth app
  //   NGAP_ONEARTH_APP_NAME - The name of the OnEarth app in the NGAP PaaS
  const ngapAppName = process.env.NGAP_ONEARTH_APP_NAME;

  return ngapAppName ?
         getOnEarthServiceStatusNgap(ngapAppName) :
         getOnEarthServiceStatusCloudFormation(stackName);
};

/**
 * Returns a list of the status of all the services.
 */
const getServicesStatus = async (mainStackName, onEarthStackName) => {
  const ingestStackResources = await getIngestStackResources(mainStackName);

  const [providerToUsedConnections, ingestServicesStatus, onEarthStatus] = await Promise.all([
    getCurrentUseConnections(mainStackName, ingestStackResources),
    getIngestServicesStatus(ingestStackResources),
    getOnEarthServiceStatus(onEarthStackName)
  ]);
  ingestServicesStatus.push(onEarthStatus);
  return {
    services: ingestServicesStatus,
    connections: providerToUsedConnections
  };
};

/**
 * handleServiceStatusRequest - Handles the API request for service status.
 */
const handleServiceStatusRequest = async (req, res) => {
  try {
    const mainStackName = process.env.STACK_NAME;
    const onEarthStackName = process.env.on_earth_stack_name;
    const status = await getServicesStatus(mainStackName, onEarthStackName);
    res.json(status);
  }
  catch (e) {
    console.error(e);
    handleError(e, req, res);
  }
};

module.exports = { handleServiceStatusRequest };

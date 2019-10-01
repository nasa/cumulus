'use strict';

const aws = require('./aws');

/**
 * list the clusters
 *
 * @returns {Array<string>} the cluster arns
 */
async function listEcsClusters() {
  let response;
  let clusterArns = [];
  do {
    const nextToken = response ? response.nextToken : null;
    const params = { maxResults: 100, nextToken };
    // eslint-disable-next-line no-await-in-loop
    response = await aws.ecs().listClusters().promise(params);
    clusterArns = clusterArns.concat(response.clusterArns);
  } while (response.nextToken);

  return clusterArns;
}

/**
 * get cluster and service arns for the given stack and service task
 *
 * @param {string} stackName -  The name of the stack
 * @param {string} taskName - The task name of ECS service
 * @returns {Object} the object with `cluster` and `service` arns
 */
async function getEcsClusterService(stackName, taskName) {
  const clusterArns = await listEcsClusters();
  const clusterName = `${stackName}-CumulusECSCluster`;
  const clusters = clusterArns.filter((clusterArn) => clusterArn.includes(clusterName));
  if (clusters.length === 0) return Promise.reject(new Error(`ECS cluster not found ${clusterName}`));

  const cluster = clusters[0];
  const params = { cluster, launchType: 'EC2', schedulingStrategy: 'REPLICA' };
  const response = await aws.ecs().listServices(params).promise();

  const serviceName = `${stackName}-${taskName}ECSService`;
  const services = response.serviceArns.filter((serviceArn) => serviceArn.includes(serviceName));
  if (services.length === 0) return Promise.reject(new Error(`ECS service not found ${serviceName}`));

  return { cluster, service: services[0] };
}

/**
 * get ECS service events
 *
 * @param {string} cluster -  cluster arn
 * @param {string} service - service arn
 * @param {Date} startTime - start time of the events
 * @returns {Object} the object with `cluster` and `service` arns
 */
async function getEcsServiceEvents(cluster, service, startTime) {
  const params = { cluster, services: [service] };
  const response = await aws.ecs().describeServices(params).promise();
  const events = (response.services)[0].events
    .filter((event) => event.createdAt.getTime() > startTime.getTime());
  return events;
}

module.exports = {
  listEcsClusters,
  getEcsClusterService,
  getEcsServiceEvents
};

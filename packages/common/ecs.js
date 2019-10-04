'use strict';

const aws = require('./aws');

/**
 * list the clusters
 *
 * @returns {Array<string>} the cluster arns
 */
async function listEcsClusterArns() {
  let response;
  let clusterArns = [];
  do {
    const nextToken = response ? response.nextToken : null;
    const params = { nextToken };

    // eslint-disable-next-line no-await-in-loop
    response = await aws.ecs().listClusters(params).promise();
    clusterArns = clusterArns.concat(response.clusterArns);
  } while (response.nextToken);

  return clusterArns;
}

/**
 * list the services for the given cluster
 *
 * @param {string} clusterArn - the cluster arn
 * @param {string} launchType - the launch type, default to 'EC2'
 * @param {string} schedulingStrategy - the scheduling strategy, default to 'REPLICA'
 * @returns {Array<string>} the service arns
 */
async function listEcsServiceArns(clusterArn, launchType, schedulingStrategy) {
  let response;
  let serviceArns = [];
  do {
    const nextToken = response ? response.nextToken : null;
    const params = {
      cluster: clusterArn,
      launchType: launchType || 'EC2',
      schedulingStrategy: schedulingStrategy || 'REPLICA',
      nextToken
    };

    // eslint-disable-next-line no-await-in-loop
    response = await aws.ecs().listServices(params).promise();
    serviceArns = serviceArns.concat(response.serviceArns);
  } while (response.nextToken);

  return serviceArns;
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
  return response.services[0].events
    .filter((event) => event.createdAt.getTime() > startTime.getTime());
}

module.exports = {
  listEcsClusterArns,
  listEcsServiceArns,
  getEcsServiceEvents
};

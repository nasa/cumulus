'use strict';

const AWS = require('aws-sdk');

async function getEcsClusters() {
  let response;
  let clusterArns = [];
  do {
    const nextToken = response ? response.nextToken : null;
    const params = { maxResults: 100, nextToken };
    // eslint-disable-next-line no-await-in-loop
    response = await new AWS.ECS().listClusters().promise(params);
    clusterArns = clusterArns.concat(response.clusterArns);
  } while (response.nextToken);

  return clusterArns;
}

async function getEcsClusterService(stackName, taskName) {
  const clusterArns = await getEcsClusters();
  const clusterName = `${stackName}-CumulusECSCluster`;
  const clusters = clusterArns.filter((clusterArn) => clusterArn.includes(clusterName));
  if (clusters.length === 0) return Promise.reject(new Error(`ECS cluster not found ${clusterName}`));

  const cluster = clusters[0];
  const params = { cluster, launchType: 'EC2', schedulingStrategy: 'REPLICA' };
  const response = await new AWS.ECS().listServices(params).promise();

  const serviceName = `${stackName}-${taskName}ECSService`;
  const services = response.serviceArns.filter((serviceArn) => serviceArn.includes(serviceName));
  if (services.length === 0) return Promise.reject(new Error(`ECS service not found ${serviceName}`));

  return { cluster, service: services[0] };
}

async function getServiceEvents(cluster, service, startTime) {
  console.log('getServiceEvents', cluster, service, startTime);
  const params = { cluster, services: [service] };
  const response = await new AWS.ECS().describeServices(params).promise();
  const events = (response.services)[0].events
    .filter((event) => event.createdAt.getTime() > startTime.getTime());
  return events;
}

module.exports = {
  getEcsClusterService,
  getServiceEvents
};

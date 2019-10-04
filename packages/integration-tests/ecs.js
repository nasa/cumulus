'use strict';

const { listEcsClusterArns, listEcsServiceArns } = require('@cumulus/common/ecs');

/**
 * get cluster arn for the given stack
 *
 * @param {string} stackName - The name of the stack
 * @returns {string} the cluster arn
 */
async function getEcsClusterArn(stackName) {
  const clusterArns = await listEcsClusterArns();
  const clusterName = `${stackName}-CumulusECSCluster`;
  const cluster = clusterArns.find((clusterArn) => clusterArn.includes(clusterName));
  if (cluster === undefined) throw new Error(`ECS cluster not found ${clusterName}`);
  return cluster;
}

/**
 * get service arn for the given cluster arn, stack name and service task name
 *
 * @param {string} clusterArn - The cluster arn
 * @param {string} stackName -  The name of the stack
 * @param {string} taskName - The task name of ECS service
 * @returns {string} the service arn
 */
async function getEcsServiceArn(clusterArn, stackName, taskName) {
  const serviceArns = await listEcsServiceArns(clusterArn);
  const serviceName = `${stackName}-${taskName}ECSService`;
  const service = serviceArns.find((serviceArn) => serviceArn.includes(serviceName));
  if (service === undefined) throw new Error(`ECS service not found ${serviceName}`);
  return service;
}

module.exports = {
  getEcsClusterArn,
  getEcsServiceArn
};

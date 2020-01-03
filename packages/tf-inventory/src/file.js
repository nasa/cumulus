'use strict';

const aws = require('@cumulus/common/aws');
const {
  listResourcesForFile,
  listTfStateFiles
} = require('./stateFile');

function mergeResources(x, y) {
  const keys = Object.keys(x);
  const val = {};

  keys.forEach((k) => val[k] = [].concat(x[k], y[k]));

  return val;
}

function diff(A, B) {
  return A.filter(function (a) {
      return B.indexOf(a) == -1;
  });
}

function resourceDiff(x, y) {
  const keys = Object.keys(x);
  const val = {};

  keys.forEach((k) => val[k] = diff(x[k], y[k]));

  return val;
}

async function listTfResources(stateFiles) {
  const resourcePromises = stateFiles.map((stateFile) => listResourcesForFile(stateFile));

  const resources = await Promise.all(resourcePromises);

  return resources.reduce(mergeResources);
}

async function listAwsResources() {
  const ecsClusters = await aws.ecs().listClusters().promise();

  let ec2Instances = await aws.ec2().describeInstances().promise();
  ec2Instances = [].concat.apply([], ec2Instances.Reservations.map((e) => e.Instances));
  ec2Instances = ec2Instances.map((inst) => inst.InstanceId);

  return {
    ecsClusters: ecsClusters.clusterArns,
    ec2Instances
  };
}

function listTfDeployments(stateFiles) {
  let deployments = stateFiles.map((file) => {
    const deployment = file.match(/(.*)\/(.*)\/(data-persistence*|cumulus*)\/terraform.tfstate/);
    if (!deployment || deployment.length < 3) {
      console.log(`Deployment: ${file}`);
      return null;
    }

    return deployment[2];
  });

  deployments = deployments.filter((deployment) => deployment !== null);
  deployments = Array.from(new Set(deployments));

  console.log(deployments);

  return deployments;
}

async function reconcileResources() {
  const stateFiles = await listTfStateFiles();

  listTfDeployments(stateFiles);

  const tfResources = await listTfResources(stateFiles);
  const awsResources = await listAwsResources();

  return resourceDiff(awsResources, tfResources);
}

module.exports = {
};

reconcileResources()
  .then(console.log)
  .catch(console.log);

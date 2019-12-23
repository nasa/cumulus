'use strict';

// const AWS = require('aws-sdk');
const aws = require('@cumulus/common/aws');

function listBucketTfStateFiles(bucket) {
  return aws.listS3ObjectsV2({ Bucket: bucket })
    .then((bucketObjects) => bucketObjects.filter((obj) => obj.Key.includes('tfstate')))
    .catch((e) => {
      console.log(`error reading bucket ${bucket}`);
      return [];
    });
}

async function listAllTfStateFiles() {
  const buckets = await aws.s3().listBuckets().promise();

  // TO DO: change to regex
  let tfStateBuckets = buckets.Buckets.filter((bucket) => bucket.Name.includes('tfstate') || bucket.Name.includes('tf-state'));

  // tfStateBuckets = [ tfStateBuckets[0] ];

  const bucketPromises = tfStateBuckets.map(async (bucket) => {
    return {
    bucket: bucket.Name,
    stateFiles: await listBucketTfStateFiles(bucket.Name)
  }});

  return Promise.all(bucketPromises);
}

async function listClusterEC2Intances(clusterArn) {
  const clusterContainerInstances = await aws.ecs().listContainerInstances({
    cluster: clusterArn
  }).promise()
  .catch((e) => {
    console.log(`Cluster ${clusterArn} ${e}`);
    return [];
  });

  if (!clusterContainerInstances || !clusterContainerInstances.containerInstanceArns) {
    return [];
  }

  const containerInstances = await aws.ecs().describeContainerInstances({
    cluster: clusterArn,
    containerInstances: clusterContainerInstances.containerInstanceArns
  }).promise();

  return containerInstances.containerInstances.map((c) => c.ec2InstanceId);
}

async function listResourcesForFile(bucket, file) {
  const stateFile = await aws.getS3Object(bucket, file.Key);

  const resources = JSON.parse(stateFile.Body);

  let ecsClusters = resources.resources
    .filter((r) => r.type === 'aws_ecs_cluster')
    .map((c) => c.instances.map((i) => i.attributes.arn));
  ecsClusters = [].concat.apply([], ecsClusters);

  const ec2InstancePromises = ecsClusters.map((c) =>
    listClusterEC2Intances(c));

  let ec2Instances = await Promise.all(ec2InstancePromises);
  ec2Instances = [].concat.apply([], ec2Instances);

  return { ecsClusters, ec2Instances };
}

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

async function listTfResources() {
  const stateFilesByBucket = await listAllTfStateFiles();

  let resourcePromises = stateFilesByBucket.map((bucket) =>
    bucket.stateFiles.map((sf) => listResourcesForFile(bucket.bucket, sf)));

  resourcePromises = [].concat.apply([], resourcePromises);

  let resources = await Promise.all(resourcePromises);
  resources = resources.reduce(mergeResources);

  return resources;
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

async function reconcileResources() {
  const tfResources = await listTfResources();
  const awsResources = await listAwsResources();

  return resourceDiff(awsResources, tfResources);
}

module.exports = {
  listAllTfStateFiles
};

reconcileResources()
  .then(console.log)
  .catch(console.log);



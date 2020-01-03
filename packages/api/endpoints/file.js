'use strict';

// const AWS = require('aws-sdk');
const aws = require('@cumulus/common/aws');

async function getStateFilesFromTable(tableName) {
  const tableInfo = await aws.dynamodb().describeTable({ TableName: tableName }).promise();

  if (tableInfo.Table.AttributeDefinitions[0].AttributeName === 'LockID'
      && tableInfo.Table.ItemCount > 0) {
    let stateFiles = [];
    const scanQueue = new aws.DynamoDbSearchQueue({ TableName: tableName });

    let itemsComplete = false;

    /* eslint-disable no-await-in-loop */
    while (itemsComplete === false) {
      await scanQueue.fetchItems();

      itemsComplete = scanQueue.items[scanQueue.items.length - 1] === null;

      if (itemsComplete) {
        // pop the null item off
        scanQueue.items.pop();
      }

      stateFiles = stateFiles.concat(scanQueue.items.map((i) => i.LockID.slice(0, -4)));
    }

    return stateFiles;
  }
  /* eslint-enable no-await-in-loop */

  return [];
}

async function listTfStateFiles() {
  let tables = await aws.dynamodb().listTables().promise();
  let tablesComplete = false;
  let stateFiles = [];

  /* eslint-disable no-await-in-loop */
  while (!tablesComplete) {
    const stateFilePromises = tables.TableNames.map((t) => getStateFilesFromTable(t));

    const stateFileArrays = await Promise.all(stateFilePromises);

    stateFiles = [].concat.apply(stateFiles, stateFileArrays);

    if (!tables.LastEvaluatedTableName) {
      tablesComplete = true;
    } else {
      tables = await aws.dynamodb().listTables({
        ExclusiveStartTableName: tables.LastEvaluatedTableName
      }).promise();
    }
  }
  /* eslint-enable no-await-in-loop */

  return stateFiles;
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

async function listResourcesForFile(file) {
  const { Bucket, Key } = aws.parseS3Uri(`s3://${file}`);

  try {
    const stateFile = await aws.getS3Object(Bucket, Key);

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
  } catch (e) {
    console.log(`Error reading ${file}: ${e}`);
    return { };
  }
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

/* eslint-disable no-console */

'use strict';

const groupBy = require('lodash.groupby');
const aws = require('@cumulus/aws-client/services');
const { getS3Object, parseS3Uri } = require('@cumulus/aws-client/S3');
const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');

/**
 * Get list of state files paths `bucket/key` from a table if the table
 * contains state files
 *
 * @param {string} tableName - table name
 * @returns {Promise<Array<string>>} - list of state file paths
 */
async function getStateFilesFromTable(tableName) {
  try {
    const tableInfo = await aws.dynamodb().describeTable({ TableName: tableName }).promise();

    // Check that the table holds state files and actually has items
    if (tableInfo.Table.AttributeDefinitions[0].AttributeName === 'LockID'
        && tableInfo.Table.ItemCount > 0) {
      let stateFiles = [];
      const scanQueue = new DynamoDbSearchQueue({ TableName: tableName });

      let itemsComplete = false;

      /* eslint-disable no-await-in-loop */
      while (itemsComplete === false) {
        await scanQueue.fetchItems();

        itemsComplete = scanQueue.items[scanQueue.items.length - 1] === null;

        if (itemsComplete) {
          // pop the null item off
          scanQueue.items.pop();
        }

        // Slice off the .md5 extension since this is listing the checksums
        stateFiles = stateFiles.concat(scanQueue.items.map((i) => i.LockID.slice(0, -4)));
      }

      return stateFiles;
    }
    /* eslint-enable no-await-in-loop */
  } catch (e) {
    console.log(`Error describing table ${tableName}: ${e}`);
  }

  return [];
}

/**
 * List all TF state files found in all Dynamo tables on the account
 *
 * @returns {Promise<Array<string>>} - list of tf state file paths in
 * the form bucket/key
 */
async function listTfStateFiles() {
  let tables = await aws.dynamodb().listTables().promise();
  let tablesComplete = false;
  let stateFiles = [];

  /* eslint-disable no-await-in-loop */
  while (!tablesComplete) {
    const stateFilePromises = tables.TableNames.map(getStateFilesFromTable);

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

/**
 * List the EC2 instances in the AWS account that are associated
 * with the ECS cluster
 *
 * @param {string} clusterArn
 * @returns {Promise<Array<string>>} - ec2 instance ids
 */
async function listClusterEC2Instances(clusterArn) {
  const clusterContainerInstances = await aws.ecs().listContainerInstances({
    cluster: clusterArn
  }).promise()
    .catch((e) => {
      console.log(`Error listing container instances for cluster ${clusterArn}: ${e}`);
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

/**
 * Extract the deployment name using a regular expression
 * on the filename. Assumes state file name is
 * bucket/deployment/cumulus|data-persistence/terraform.tfstate
 *
 * @param {string} filename - path to state file: bucket/key
 * @returns {string} - deployment name
 */
function extractDeploymentName(filename) {
  const deployment = filename
    .match(/(.*)\/(.*)\/(data-persistence.*|cumulus.*)\/terraform.tfstate/);
  if (!deployment || deployment.length < 3) {
    console.log(`Error extracting deployment name from file ${filename}`);
    return null;
  }

  return deployment[2];
}

/**
 * Get a list of resources from the given state file
 *
 * @param {string} file - the file location as `bucket/key`
 * @returns {Array<Object>} - list of resource objects
 */
async function getStateFileDeploymentInfo(file) {
  const { Bucket, Key } = parseS3Uri(`s3://${file}`);

  try {
    const stateFile = await getS3Object(Bucket, Key);

    const stateFileBody = JSON.parse(stateFile.Body);

    return {
      file,
      deployment: extractDeploymentName(file),
      lastModified: stateFile.LastModified,
      resources: stateFileBody.resources
    };
  } catch (e) {
    console.log(`Error reading ${file}: ${e.message}`);
  }

  return null;
}

/**
 * List the ECS clusters and EC2 instances defined in the state file.
 *
 * @param {string} file - file path
 * @returns {Promise<Object>}
 */
async function listResourcesForFile(file) {
  const stateFile = await getStateFileDeploymentInfo(file);

  if (stateFile && stateFile.resources) {
    let ecsClusters = stateFile.resources
      .filter((r) => r.type === 'aws_ecs_cluster')
      .map((c) => c.instances.map((i) => i.attributes.arn));
    ecsClusters = [].concat(...ecsClusters);

    const ec2InstancePromises = ecsClusters.map((c) =>
      listClusterEC2Instances(c));

    let ec2Instances = await Promise.all(ec2InstancePromises);
    ec2Instances = [].concat(...ec2Instances);

    return { ecsClusters, ec2Instances };
  }

  return { };
}

/**
 * List terraform deployments in the accounts based on the list
 * of state files
 *
 * @param {Array<string>} stateFiles - state file paths
 * @returns {Array<string>} list of deployments
 */
function listTfDeployments(stateFiles) {
  let deployments = stateFiles.map((file) => extractDeploymentName(file));

  deployments = deployments.filter((deployment) => deployment !== null);
  deployments = Array.from(new Set(deployments));

  return deployments.sort();
}

/**
 * Create a report containing all deployments identified that includes
 * state file paths, time state file was updated and number of resources in the state file
 *
 * @returns {Promise<Object>} Object where key is deployment name. Looks like:
 * cumulus-tf
  [ { file: 'cumulus-sandbox-tfstate/cumulus-tf/cumulus/terraform.tfstate',
      deployment: 'cumulus-tf',
      lastModified: 2019-12-16T23:36:37.000Z,
      resources: 433 },
    { file: 'cumulus-sandbox-tfstate/cumulus-tf/data-persistence/terraform.tfstate',
      deployment: 'cumulus-tf',
      lastModified: 2019-12-10T23:22:39.000Z,
      resources: 20 } ]
 */
async function deploymentReport() {
  const stateFiles = await listTfStateFiles();

  const resourcePromises = stateFiles.map((sf) => getStateFileDeploymentInfo(sf));
  let resources = await Promise.all(resourcePromises);
  resources = resources.filter((r) => r && r.deployment !== undefined);

  const resourcesForReports = resources.map((r) => ({
    ...r,
    resources: r.resources ? r.resources.length : 0
  }));

  const resourcesByDeployment = groupBy(resourcesForReports, (r) => r.deployment);

  return resourcesByDeployment;
}

module.exports = {
  deploymentReport,
  getStateFileDeploymentInfo,
  listResourcesForFile,
  listTfDeployments,
  listTfStateFiles
};

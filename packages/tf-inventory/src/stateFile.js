/* eslint-disable no-console */

'use strict';

const aws = require('@cumulus/common/aws');

/**
 * Get list of state files paths `bucket/key` from a table if the table
 * contains state files
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
 * Get a list of resources from the given state file
 * @param {string} file - the file location as `bucket/key`
 * @returns {Array<Object>} - list of resource objects
 */
async function getStateFileResources(file) {
  const { Bucket, Key } = aws.parseS3Uri(`s3://${file}`);

  try {
    const stateFile = await aws.getS3Object(Bucket, Key);

    const resources = JSON.parse(stateFile.Body);

    return resources.resources;
  } catch (e) {
    console.log(`Error reading ${file}: ${e.message}`);
  }

  return null;
}

async function listResourcesForFile(file) {
  const resources = await getStateFileResources(file);

  if (resources) {
    let ecsClusters = resources
      .filter((r) => r.type === 'aws_ecs_cluster')
      .map((c) => c.instances.map((i) => i.attributes.arn));
    ecsClusters = [].concat(...ecsClusters);

    const ec2InstancePromises = ecsClusters.map((c) =>
      listClusterEC2Intances(c));

    let ec2Instances = await Promise.all(ec2InstancePromises);
    ec2Instances = [].concat(...ec2Instances);

    return { ecsClusters, ec2Instances };
  }

  return { };
}

/**
 * List terraform deployments in the accounts based on the list
 * of state files
 * @param {Array<string>} stateFiles - state file paths
 * @returns {Array<string>} list of deployments
 */
function listTfDeployments(stateFiles) {
  let deployments = stateFiles.map((file) => {
    const deployment = file.match(/(.*)\/(.*)\/(data-persistence.*|cumulus.*)\/terraform.tfstate/);
    if (!deployment || deployment.length < 3) {
      console.log(`Error extracting deployment name from file ${file}`);
      return null;
    }

    return deployment[2];
  });

  deployments = deployments.filter((deployment) => deployment !== null);
  deployments = Array.from(new Set(deployments));

  return deployments;
}

module.exports = {
  listResourcesForFile,
  listTfDeployments,
  listTfStateFiles
};

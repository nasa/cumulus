'use strict';

const test = require('ava');
const rewire = require('rewire');
const fs = require('fs');
const path = require('path');

const stateFile = rewire('../src/stateFile');
const getStateFilesFromTable = stateFile.__get__('getStateFilesFromTable');
const getStateFileResources = stateFile.__get__('getStateFileResources');

const revertListClusterEC2Intances = stateFile.__set__(
  'listClusterEC2Intances',
  () => ['i-1234', 'i-4321']
);

const {
  aws,
  testUtils: { randomString }
} = require('@cumulus/common');

async function createTable(tableName, attributeDefs, keySchema) {
  await aws.dynamodb().createTable({
    TableName: tableName,
    AttributeDefinitions: attributeDefs,
    KeySchema: keySchema,
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  }).promise();

  return aws.dynamodb().waitFor('tableExists', { TableName: tableName }).promise();
}

test.after.always(() => {
  revertListClusterEC2Intances();
});

test('getStateFilesFromTable returns empty array if it is not a table containing state files', async (t) => {
  const tableName = randomString();
  await createTable(tableName, [{ AttributeName: 'bucket', AttributeType: 'S' }], [{ AttributeName: 'bucket', KeyType: 'HASH' }]);
  await aws.dynamodb().putItem({
    TableName: tableName,
    Item: { bucket: { S: 'bucket' } }
  }).promise();
  const stateFiles = await getStateFilesFromTable(tableName);

  t.deepEqual([], stateFiles);

  await aws.dynamodb().deleteTable({ TableName: tableName }).promise();
});

test('getStateFilesFromTable returns empty array if there are no items in the table', async (t) => {
  const tableName = randomString();
  await createTable(tableName, [{ AttributeName: 'LockID', AttributeType: 'S' }], [{ AttributeName: 'LockID', KeyType: 'HASH' }]);
  const stateFiles = await getStateFilesFromTable(tableName);

  t.deepEqual([], stateFiles);

  await aws.dynamodb().deleteTable({ TableName: tableName }).promise();
});

test('getStateFilesFromTable returns state files without checksum extension', async (t) => {
  const tableName = randomString();
  await createTable(tableName, [{ AttributeName: 'LockID', AttributeType: 'S' }], [{ AttributeName: 'LockID', KeyType: 'HASH' }]);

  await aws.dynamodb().putItem({
    TableName: tableName,
    Item: { LockID: { S: 'cumulus-tfstate/tf-deployment/cumulus/terraform.tfstate.md5' } }
  }).promise();

  const stateFiles = await getStateFilesFromTable(tableName);

  t.deepEqual(['cumulus-tfstate/tf-deployment/cumulus/terraform.tfstate'], stateFiles);

  await aws.dynamodb().deleteTable({ TableName: tableName }).promise();
});

test('listTfStateFiles lists state files only', async (t) => {
  const stateFileTableName = randomString();
  await createTable(stateFileTableName, [{ AttributeName: 'LockID', AttributeType: 'S' }], [{ AttributeName: 'LockID', KeyType: 'HASH' }]);

  await aws.dynamodb().putItem({
    TableName: stateFileTableName,
    Item: { LockID: { S: 'cumulus-tfstate/tf-deployment/cumulus/terraform.tfstate.md5' } }
  }).promise();

  const noStateFileTableName = randomString();
  await createTable(noStateFileTableName, [{ AttributeName: 'bucket', AttributeType: 'S' }], [{ AttributeName: 'bucket', KeyType: 'HASH' }]);

  await aws.dynamodb().putItem({
    TableName: noStateFileTableName,
    Item: { bucket: { S: 'bucket' } }
  }).promise();

  const stateFiles = await stateFile.listTfStateFiles();

  t.deepEqual(['cumulus-tfstate/tf-deployment/cumulus/terraform.tfstate'], stateFiles);

  await aws.dynamodb().deleteTable({ TableName: stateFileTableName }).promise();
  await aws.dynamodb().deleteTable({ TableName: noStateFileTableName }).promise();
});

test('getStateFileResources lists resources', async (t) => {
  const bucket = randomString();
  const key = 'terraform.tfstate';
  await aws.s3().createBucket({ Bucket: bucket }).promise();

  const state = fs.readFileSync(path.join(__dirname, './resources/sampleTfState.tfstate'), 'utf8');

  await aws.promiseS3Upload({
    Bucket: bucket,
    Key: key,
    Body: state
  });

  const resources = await getStateFileResources(`${bucket}/${key}`);
  t.deepEqual(
    ['aws_caller_identity', 'aws_ecs_cluster'],
    resources.map((r) => r.type)
  );

  await aws.recursivelyDeleteS3Bucket(bucket);
});

test('listResourcesForFile lists resources', async (t) => {
  const bucket = randomString();
  const key = 'terraform.tfstate';
  await aws.s3().createBucket({ Bucket: bucket }).promise();

  const state = fs.readFileSync(path.join(__dirname, './resources/sampleTfState.tfstate'), 'utf8');

  await aws.promiseS3Upload({
    Bucket: bucket,
    Key: key,
    Body: state
  });

  const resources = await stateFile.listResourcesForFile(`${bucket}/${key}`);
  t.deepEqual(
    {
      ecsClusters: ['arn:aws:ecs:us-east-1:12345:cluster/lpf-tf-CumulusECSCluster'],
      ec2Instances: ['i-1234', 'i-4321']
    },
    resources
  );

  await aws.recursivelyDeleteS3Bucket(bucket);
});

test('listTfDeployments lists unique Tf deployments based on state file name', (t) => {
  const stateFiles = [
    'bucket/cumulus/data-persistence/terraform.tfstate',
    'bucket/cumulus/cumulus/terraform.tfstate',
    'bucket/tf/data-persistence-tf/terraform.tfstate',
    'bucket/tf/cumulus-tf/terraform.tfstate'
  ];

  const deployments = stateFile.listTfDeployments(stateFiles);

  t.deepEqual(deployments, ['cumulus', 'tf']);
});

'use strict';

const test = require('ava');
const rewire = require('rewire');
const fs = require('fs');
const path = require('path');

const stateFile = rewire('../src/stateFile');
const getStateFilesFromTable = stateFile.__get__('getStateFilesFromTable');
const extractDeploymentName = stateFile.__get__('extractDeploymentName');

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

  const resources = await stateFile.getStateFileDeploymentInfo(`${bucket}/${key}`);
  console.log(resources);

  t.deepEqual(
    ['aws_caller_identity', 'aws_ecs_cluster'],
    resources.resources.map((r) => r.type)
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

test('extractDeploymentName extracts deployment name for cumulus deployment', (t) => {
  t.is(extractDeploymentName('bucket/cumulus/cumulus/terraform.tfstate'), 'cumulus');
});

test('extractDeploymentName extracts deployment name for data persistence deployment', (t) => {
  t.is(extractDeploymentName('bucket/cumulus/data-persistence/terraform.tfstate'), 'cumulus');
});

test('extractDeploymentName returns null if deployment name cannot be extracted', (t) => {
  t.is(extractDeploymentName('tf-deployments/terraform.tfstate'), null);
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

test('deploymentReport returns information about the deployment', async (t) => {
  const revertListFilesStub = stateFile.__set__(
    'listTfStateFiles',
    () => ['cumulus-1', 'cumulus-1', 'cumulus-2']
  );

  const revertGetDeploymentInfoStub = stateFile.__set__(
    'getStateFileDeploymentInfo',
    (file) => { return {
              file,
              deployment: file,
              lastModified: new Date(2020, 1, 1),
              resources: [1, 2]
            }}
  );

  const report = await stateFile.deploymentReport();

  t.is(Object.keys(report).length, 2);

  t.is(report['cumulus-1'].length, 2);
  t.is(report['cumulus-2'].length, 1);

  t.is(report['cumulus-1'][0].resources, 2);

  revertGetDeploymentInfoStub();
  revertListFilesStub();

  // deploymentInfoStub.restore();
});

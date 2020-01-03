'use strict';

const test = require('ava');
const rewire = require('rewire');

const stateFile = rewire('../src/stateFile');
const getStateFilesFromTable = stateFile.__get__('getStateFilesFromTable');

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

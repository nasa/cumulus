'use strict';

const test = require('ava');
const uuidv4 = require('uuid/v4');
const cryptoRandomString = require('crypto-random-string');
const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const awsServices = require('@cumulus/aws-client/services');
const {
  tableNames,
  createTestDatabase,
  localStackConnectionEnv,
  getKnexClient,
} = require('@cumulus/db');
// eslint-disable-next-line unicorn/import-index
const { updateAsyncOperation } = require('../index');

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;
// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../../../../lambdas/db-migration');

test.before(async (t) => {
  t.context.dynamoTableName = cryptoRandomString({ length: 10 });
  t.context.asyncOperationId = uuidv4();

  const tableHash = { name: 'id', type: 'S' };
  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: t.context.dynamoTableName,
    AttributeDefinitions: [{
      AttributeName: tableHash.name,
      AttributeType: tableHash.type,
    }],
    KeySchema: [{
      AttributeName: tableHash.name,
      KeyType: 'HASH',
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });

  t.context.knexAdmin = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
    },
  });
  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });

  await createTestDatabase(t.context.knexAdmin, testDbName, localStackConnectionEnv.PG_USER);
  await t.context.knex.migrate.latest();
  await t.context.knex(tableNames.asyncOperations).insert({
    id: t.context.asyncOperationId,
    description: 'test description',
    operation_type: 'ES Index',
    status: 'RUNNING',
  });
});

test('updateAsyncOperation updates databases as expected', async (t) => {
  const dynamodbDocClient = awsServices.dynamodbDocClient({ convertEmptyValues: true });
  const status = 'SUCCEEDED';
  const output = { foo: 'bar' };
  const updateTime = (Number(Date.now())).toString();
  const result = await updateAsyncOperation(
    status,
    output,
    {
      asyncOperationsTable: t.context.dynamoTableName,
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    }
  );

  // Query RDS for result
  const rdsResponse = await t.context.knex(tableNames.asyncOperations)
    .select('id', 'status', 'output', 'updated_at')
    .where('id', t.context.asyncOperationId);
  const dynamoResponse = await DynamoDb.get({
    tableName: t.context.dynamoTableName,
    item: { id: t.context.asyncOperationId },
    client: dynamodbDocClient,
    getParams: { ConsistentRead: true },
  });

  t.is(result.$response.httpResponse.statusCode, 200);
  t.deepEqual(rdsResponse, [{
    id: t.context.asyncOperationId,
    status,
    output,
    updated_at: new Date(Number(updateTime)),
  }]);
  t.deepEqual(dynamoResponse, {
    output: JSON.stringify(output),
    id: t.context.asyncOperationId,
    status,
    updatedAt: Number(updateTime),
  });
});

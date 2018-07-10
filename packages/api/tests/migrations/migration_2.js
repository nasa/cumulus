'use strict';

const test = require('ava');
const {
  aws: {
    dynamodb
  },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');
const { run } = require('../../migrations/migration_2');
const models = require('../../models');

function createAndWaitForTable(params) {
  return dynamodb().createTable(params).promise()
    .then(() => dynamodb().waitFor('tableExists', { TableName: params.TableName }).promise());
}

test.serial('build-files-table handler properly populates the files table', async (t) => {
  // Create the two tables
  t.context.granulesTableName = randomString();
  t.context.filesTableName = randomString();

  const granulesTableParams = {
    TableName: t.context.granulesTableName,
    AttributeDefinitions: [
      { AttributeName: 'granuleId', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'granuleId', KeyType: 'HASH' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  const filesTableParams = {
    TableName: t.context.filesTableName,
    AttributeDefinitions: [
      { AttributeName: 'bucket', AttributeType: 'S' },
      { AttributeName: 'key', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'bucket', KeyType: 'HASH' },
      { AttributeName: 'key', KeyType: 'RANGE' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  await createAndWaitForTable(granulesTableParams);
  await createAndWaitForTable(filesTableParams);

  // Write data to the granules table
  const batchWriteItemParams = { RequestItems: {} };
  batchWriteItemParams.RequestItems[t.context.granulesTableName] = [
    {
      PutRequest: {
        Item: {
          granuleId: { S: 'granule-1' },
          files: {
            L: [
              {
                M: {
                  bucket: { S: 'bucket-1-public' },
                  filename: { S: 's3://bucket-1-public/granule-1-file-1.hdf' }
                }
              },
              {
                M: {
                  bucket: { S: 'bucket-1-protected' },
                  filename: { S: 's3://bucket-1-protected/granule-1-file-2.hdf' }
                }
              },
              {
                M: {
                  bucket: { S: 'bucket-1-protected' },
                  filename: { S: 's3://bucket-1-protected/granule-1-file-3.hdf' }
                }
              }
            ]
          }
        }
      }
    },
    {
      PutRequest: {
        Item: {
          granuleId: { S: 'granule-2' },
          files: {
            L: [
              {
                M: {
                  bucket: { S: 'bucket-2-public' },
                  filename: { S: 's3://bucket-2-public/granule-2-file-1.hdf' }
                }
              },
              {
                M: {
                  bucket: { S: 'bucket-2-protected' },
                  filename: { S: 's3://bucket-2-protected/granule-2-file-2.hdf' }
                }
              },
              {
                M: {
                  bucket: { S: 'bucket-2-protected' },
                  filename: { S: 's3://bucket-2-protected/granule-2-file-3.hdf' }
                }
              }
            ]
          }
        }
      }
    }
  ];

  await dynamodb().batchWriteItem(batchWriteItemParams).promise();

  // Run the task
  await run({
    granulesTable: t.context.granulesTableName,
    filesTable: t.context.filesTableName
  });

  // Verify that the files table is properly populated
  const defaultQueryParams = {
    TableName: t.context.filesTableName,
    ExpressionAttributeNames: {
      '#b': 'bucket',
      '#k': 'key'
    },
    KeyConditionExpression: '#b = :b AND #k = :k',
    Select: 'COUNT'
  };

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-1-public' },
      ':k': { S: 'granule-1-file-1.hdf' }
    }
  })).promise()).Count, 1);

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-1-protected' },
      ':k': { S: 'granule-1-file-2.hdf' }
    }
  })).promise()).Count, 1);

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-1-protected' },
      ':k': { S: 'granule-1-file-3.hdf' }
    }
  })).promise()).Count, 1);

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-2-public' },
      ':k': { S: 'granule-2-file-1.hdf' }
    }
  })).promise()).Count, 1);

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-2-protected' },
      ':k': { S: 'granule-2-file-2.hdf' }
    }
  })).promise()).Count, 1);

  t.is((await dynamodb().query(Object.assign({}, defaultQueryParams, {
    ExpressionAttributeValues: {
      ':b': { S: 'bucket-2-protected' },
      ':k': { S: 'granule-2-file-3.hdf' }
    }
  })).promise()).Count, 1);
});

test.afterEach.always(async (t) => {
  await models.Manager.deleteTable(t.context.granulesTableName);
  await models.Manager.deleteTable(t.context.filesTableName);
});

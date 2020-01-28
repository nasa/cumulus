'use strict';

const test = require('ava');
const { dynamodb } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const { run } = require('../../migrations/migration_2');
const models = require('../../models');

test('build-files-table handler properly populates the files table', async (t) => {
  // Create the two tables
  t.context.filesTableName = randomString();
  process.env.FilesTable = t.context.filesTableName;
  t.context.fileModel = new models.FileClass();

  t.context.granulesTableName = randomString();
  process.env.GranulesTable = t.context.granulesTableName;
  t.context.granuleModel = new models.Granule();

  await t.context.fileModel.createTable();
  await t.context.granuleModel.createTable();

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
  await t.context.fileModel.deleteTable();
  await t.context.granuleModel.deleteTable();
});

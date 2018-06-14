'use strict';

const { TaskQueue } = require('cwait');
const {
  chunk,
  drop,
  flatten
} = require('lodash');
const {
  aws: {
    dynamodb,
    DynamoDbScanQueue,
    parseS3Uri
  }
} = require('@cumulus/common');

function filePutRequestsFromGranule(granule) {
  return granule.files.L.map((file) => ({
    PutRequest: {
      Item: {
        bucket: { S: file.M.bucket.S },
        key: { S: parseS3Uri(file.M.filename.S).Key },
        granuleId: { S: granule.granuleId.S }
      }
    }
  }));
}

async function buildFilesTable(granulesTableName, filesTableName) {
  const granuleTableScanQueue = new DynamoDbScanQueue({
    TableName: granulesTableName,
    ProjectionExpression: 'granuleId, files'
  });

  let filePutRequestBuffer = [];

  let nextGranule = await granuleTableScanQueue.shift();
  while (nextGranule) {
    filePutRequestBuffer = filePutRequestBuffer.concat(filePutRequestsFromGranule(nextGranule));

    while (filePutRequestBuffer.length > 25) {
      const batchWriteItemParams = {
        RequestItems: {
          [filesTableName]: filePutRequestBuffer.slice(0, 25)
        }
      };

      await dynamodb().batchWriteItem(batchWriteItemParams).promise(); // eslint-disable-line no-await-in-loop, max-len

      filePutRequestBuffer = drop(filePutRequestBuffer, 25);
    }

    nextGranule = await granuleTableScanQueue.shift(); // eslint-disable-line no-await-in-loop
  }

  while (filePutRequestBuffer.length > 0) {
    const batchWriteItemParams = {
      RequestItems: {
        [filesTableName]: filePutRequestBuffer.slice(0, 25)
      }
    };

    await dynamodb().batchWriteItem(batchWriteItemParams).promise(); // eslint-disable-line no-await-in-loop, max-len

    filePutRequestBuffer = drop(filePutRequestBuffer, 25);
  }
}

function handler(event, _context, cb) {
  buildFilesTable(event.granulesTableName, event.filesTableName)
    .then(() => cb(null))
    .catch(cb);
}
exports.handler = handler;

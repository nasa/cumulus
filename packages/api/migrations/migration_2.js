'use strict';

const drop = require('lodash.drop');
const {
  aws: {
    dynamodb,
    DynamoDbSearchQueue,
    parseS3Uri
  }
} = require('@cumulus/common');

/**
 * Given a granule, create a DynamoDB PutRequest for each of the granule's files
 *
 * @param {Object} granule - a granule fetched from the Granules table
 * @returns {Array<Object>} - a list of PutRequest objects
 */
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

/**
 * Populate the files table in DynamoDB
 *
 * @param {Object} params - params
 * @param {string} params.granulesTable - the name of the Granules table in
 *   DynamoDB
 * @param {string} params.filesTable - the name of the Files table in DynamoDB
 * @returns {Promise<undefined>} - a Promise that resolves when the migration
 *   is complete
 */
async function run({ granulesTable, filesTable }) {
  const granuleTableScanQueue = new DynamoDbSearchQueue({
    TableName: granulesTable,
    ProjectionExpression: 'granuleId, files'
  });

  // Track DynamoDB PutRequests that need to be written to the Files table, so
  // that we can efficiently write them as a batch
  let filePutRequestBuffer = [];

  let nextGranule = await granuleTableScanQueue.shift();
  while (nextGranule) {
    filePutRequestBuffer = filePutRequestBuffer.concat(filePutRequestsFromGranule(nextGranule));

    // If there are at least 25 files to be written to DynamoDB, write them
    while (filePutRequestBuffer.length >= 25) {
      const batchWriteItemParams = {
        RequestItems: {
          [filesTable]: filePutRequestBuffer.slice(0, 25)
        }
      };

      await dynamodb().batchWriteItem(batchWriteItemParams).promise(); // eslint-disable-line no-await-in-loop, max-len

      filePutRequestBuffer = drop(filePutRequestBuffer, 25);
    }

    nextGranule = await granuleTableScanQueue.shift(); // eslint-disable-line no-await-in-loop
  }

  // Now that we've parsed all of the granules, write any remaining files to
  // the DynamoDB Files table
  while (filePutRequestBuffer.length > 0) {
    const batchWriteItemParams = {
      RequestItems: {
        [filesTable]: filePutRequestBuffer.slice(0, 25)
      }
    };

    await dynamodb().batchWriteItem(batchWriteItemParams).promise(); // eslint-disable-line no-await-in-loop, max-len

    filePutRequestBuffer = drop(filePutRequestBuffer, 25);
  }
}

module.exports.name = 'migration_2';
module.exports.run = run;

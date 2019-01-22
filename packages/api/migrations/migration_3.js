'use strict';

const { s3 } = require('@cumulus/common/aws');
const { CollectionConfigStore, constructCollectionId } = require('@cumulus/common');

/**
 * Create correct file in s3 using version number
 *
 * @param {Object} file - File Object from S3
 * @param {string} prefix - S3 key prefix
 * @param {string} bucket - S3 bucket name
 * @param {Object} collectionConfigStore - CollectionConfigStore Object
 * @returns {null} - N/A
 */
async function migrateCollection(file, prefix, bucket, collectionConfigStore) {
  const coll = await s3.getObject(file.Bucket, file.Key);
  const item = JSON.parse(coll.Body.toString());

  const dataType = item.dataType || item.name;
  const collectionId = constructCollectionId(dataType, item.dataVersion);
  const key = `${prefix}/${collectionId}.json`;

  if (!s3.fileExists(bucket, key)) {
    await collectionConfigStore.put(dataType, item.version, item);
  }
}

/**
 * Migrates exisiting collections in DynamoDB to versioned collections
 * i.e datatype___version.json in s3://internalBucket/stackName/collections/
 *
 * @param {Object} options - options passed from the main runner
 * @returns {Promise<string>} test message
 */
async function run(options) {
  const stackName = options.stackName;
  const bucket = options.bucket;
  const prefix = `${stackName}/collections`;

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  const collObjects = await s3.listS3Objects(bucket, prefix);
  const promises = collObjects.map(migrateCollection, prefix, bucket, collectionConfigStore);
  await Promise.all(promises);

  return options;
}

module.exports.name = 'migration_3';
module.exports.run = run;

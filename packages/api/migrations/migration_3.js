'use strict';

const { s3 } = require('../../common/aws');
const { CollectionConfigStore } = require('../../common');
const { constructCollectionId } = require('../lib/utils');

/**
 * Migrates exisiting collections in DynamoDB to versioned collections
 * i.e datatype___version.json in s3://internalBucket/stackName/collections/
 *
 * @param {Object} options - options passed from the main runner
 * @returns {Promise<string>} test message
 */
async function run(options) {
  const stackName = process.env.stackName;
  const bucket = process.env.internal;
  const prefix = `${stackName}/collections`;

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  async function migrateCollection(file) {
    const coll = await s3.getObject(file.Bucket, file.Key);
    const item = JSON.parse(coll.Body.toString());

    const collectionId = constructCollectionId(item.dataType, item.dataVersion);
    const key = `${prefix}/${collectionId}.json`;

    if (!s3.fileExists(bucket, key)) {
      await collectionConfigStore.put(item.dataType, item.version, item);
    }
  }

  const collObjects = await s3.listS3Objects(bucket, prefix);
  const promises = collObjects.map(migrateCollection);
  await Promise.all(promises);

  return options;
}

module.exports.name = 'migration_3';
module.exports.run = run;

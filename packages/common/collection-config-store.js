'use strict';

const { s3 } = require('./aws');


/**
 * Returns the collectionId used in elasticsearch
 * which is a combination of collection name and version
 *
 * @param {string} name - collection name
 * @param {string} version - collection version
 * @returns {string} collectionId
 */
function constructCollectionId(name, version) {
  return `${name}___${version}`;
}

/**
 * Store and retrieve collection configs in S3
 */
class CollectionConfigStore {
  /**
   * Initialize a CollectionConfigFetcher instance
   *
   * @param {string} bucket - the bucket where collection configs are stored
   * @param {string} stackName - the Cumulus deployment stack name
   */
  constructor(bucket, stackName) {
    this.bucket = bucket;
    this.stackName = stackName;
    this.cache = {};
  }

  /**
   * Fetch a collection config from S3 (or cache if available)
   *
   * @param {string} dataType - the name of the collection config to fetch
   * @param {number} dataVersion - the version of the collection config to fetch
   * @returns {Object} the fetched collection config
   */
  async get(dataType, dataVersion) {
    const collectionId = constructCollectionId(dataType, dataVersion);

    // Check to see if the collection config has already been cached
    if (!this.cache[collectionId]) {
      let response;
      try {
        // Attempt to fetch the collection config from S3
        response = await s3().getObject({
          Bucket: this.bucket,
          Key: this.configKey(collectionId)
        }).promise();
      } catch (err) {
        if (err.code === 'NoSuchKey') {
          throw new Error(`A collection config for data type "${dataType}__${dataVersion}" was not found.`);
        }

        if (err.code === 'NoSuchBucket') {
          throw new Error(`Collection config bucket does not exist: ${this.bucket}`);
        }

        throw err;
      }

      // Store the fetched collection config to the cache
      this.cache[collectionId] = JSON.parse(response.Body.toString());
    }

    return this.cache[collectionId];
  }

  /**
   * Store a collection config to S3
   *
   * @param {string} dataType - the name of the collection config to store
   * @param {string} dataVersion - version of Collection
   * @param {Object} config - the collection config to store
   * @returns {Promise<null>} resolves when the collection config has been written
   *   to S3
   */
  async put(dataType, dataVersion, config) {
    const collectionId = constructCollectionId(dataType, dataVersion);

    this.cache[collectionId] = config;

    return s3().putObject({
      Bucket: this.bucket,
      Key: this.configKey(collectionId),
      Body: JSON.stringify(config)
    }).promise().then(() => null); // Don't leak implementation details to the caller
  }

  /**
   * Delete a collection config from S3
   *
   * @param {string} dataType - the name of the collection config to delete
   * @param {string} dataVersion - version of Collection
   * @returns {Promise<null>} resolves when the collection config has been deleted
   *   to S3
   */
  async delete(dataType, dataVersion) {
    const collectionId = constructCollectionId(dataType, dataVersion);

    await s3().deleteObject({
      Bucket: this.bucket,
      Key: this.configKey(collectionId)
    }).promise();

    delete this.cache[collectionId];
  }

  /**
   * Return the S3 key pointing to the collection config
   *
   * @param {string} collectionId - the datatype and version
   * @returns {string} the S3 key where the collection config is located
   *
   * @private
   */
  configKey(collectionId) {
    return `${this.stackName}/collections/${collectionId}.json`;
  }
}

module.exports.constructCollectionId = constructCollectionId;
module.exports.CollectionConfigStore = CollectionConfigStore;

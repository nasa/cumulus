'use strict';

const { s3 } = require('./aws');

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
   * @returns {Object} the fetched collection config
   */
  async get(dataType) {
    // Check to see if the collection config has already been cached
    if (!this.cache[dataType]) {
      let response;
      try {
        // Attempt to fetch the collection config from S3
        response = await s3().getObject({
          Bucket: this.bucket,
          Key: this.configKey(dataType)
        }).promise();
      }
      catch (err) {
        if (err.code === 'NoSuchKey') {
          throw new Error(`A collection config for data type "${dataType}" was not found.`);
        }

        if (err.code === 'NoSuchBucket') {
          throw new Error(`Collection config bucket does not exist: ${this.bucket}`);
        }

        throw err;
      }

      // Store the fetched collection config to the cache
      this.cache[dataType] = JSON.parse(response.Body.toString());
    }

    return this.cache[dataType];
  }

  /**
   * Store a collection config to S3
   *
   * @param {string} dataType - the name of the collection config to store
   * @param {Object} config - the collection config to store
   * @returns {Promise<null>} resolves when the collection config has been written
   *   to S3
   */
  async put(dataType, config) {
    this.cache[dataType] = config;

    return s3().putObject({
      Bucket: this.bucket,
      Key: `${this.stackName}/collections/${dataType}.json`,
      Body: JSON.stringify(config)
    }).promise().then(() => null); // Don't leak implementation details to the caller
  }

  /**
   * Return the S3 key pointing to the collection config
   *
   * @param {string} dataType - the datatype
   * @returns {string} the S3 key where the collection config is located
   *
   * @private
   */
  configKey(dataType) {
    return `${this.stackName}/collections/${dataType}.json`;
  }
}
module.exports = CollectionConfigStore;

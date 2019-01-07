'use strict';

const isUndefined = require('lodash.isundefined');

/**
 * Class representing cumulus bucket configuration.
 */
class BucketsConfig {
  constructor(bucketsJsonObject) {
    this.buckets = bucketsJsonObject;
  }

  /**
   * returns key into this.buckets who's object has `name` bucketName
   * @param {string} bucketName
   * @returns {string} desired bucket's key value.
   */
  key(bucketName) {
    return Object.keys(this.buckets)
      .find((bucketKey) => bucketName === this.buckets[bucketKey].name);
  }

  /**
   * Return bucket type for bucketName
   * @param {string} bucketName
   * @returns {string} matching bucket's type
   */
  type(bucketName) {
    const key = this.key(bucketName);
    return this.buckets[key].type;
  }

  /**
   * returns bucket object who's name field matches bucketName
   * @param {string} bucketName
   * @returns {Object} bucket object
   */
  bucket(bucketName) {
    const key = this.key(bucketName);
    return this.buckets[key];
  }

  /**
   * returns true if bucketName is found in any attatched bucket objects.
   * @param {string} bucketName
   * @returns {boolean} truthyness of this bucket existing in the configuration
   */
  exists(bucketName) {
    return !isUndefined(this.key(bucketName));
  }

  /**
   * returns true if configKey is found on the top-level config.
   * @param {string} configKey
   * @returns {boolean} truthyness of this key existing in the configuration
   */
  keyExists(configKey) {
    return Object.keys(this.buckets).includes(configKey);
  }

  /**
   * returns name of bucket attatched to top-level config at configKey.
   * @param {string} configKey
   * @returns {string} name of bucket at key.
   */
  nameByKey(configKey) {
    return this.buckets[configKey].name;
  }
}


module.exports = BucketsConfig;

import { createErrorType } from '@cumulus/errors';
import { BucketsConfigObject } from './types';

const BucketsConfigError = createErrorType('BucketsConfigError');

/**
 * Class representing cumulus bucket configuration.
 */
class BucketsConfig {
  private readonly buckets: BucketsConfigObject;

  constructor(bucketsJsonObject: BucketsConfigObject) {
    this.buckets = bucketsJsonObject;
  }

  /**
   * returns key into this.buckets whose object has `name` bucketName
   * @param {string} bucketName
   * @returns {string|undefined} desired bucket's key value.
   */
  key(bucketName: string) {
    return Object.keys(this.buckets)
      .find((bucketKey) => bucketName === this.buckets[bucketKey].name);
  }

  /**
   * Return bucket type for bucketName
   * @param {string} bucketName
   * @returns {string} matching bucket's type
   */
  type(bucketName: string) {
    const key = this.key(bucketName);
    if (!key) {
      throw new BucketsConfigError(`bucketName ${bucketName} not found in config ${JSON.stringify(this.buckets)}`);
    }
    return this.buckets[key].type;
  }

  /**
   * returns bucket object who's name field matches bucketName
   * @param {string} bucketName
   * @returns {Object} bucket object
   */
  bucket(bucketName: string) {
    const key = this.key(bucketName);
    if (!key) {
      throw new BucketsConfigError(`bucketName ${bucketName} not found in config ${JSON.stringify(this.buckets)}`);
    }
    return this.buckets[key];
  }

  /**
   * returns true if bucketName is found in any attatched bucket objects.
   * @param {string} bucketName
   * @returns {boolean} truthyness of this bucket existing in the configuration
   */
  exists(bucketName: string) {
    return this.key(bucketName) !== undefined;
  }

  /**
   * returns true if configKey is found on the top-level config.
   * @param {string} configKey
   * @returns {boolean} truthyness of this key existing in the configuration
   */
  keyExists(configKey: string) {
    return Object.keys(this.buckets).includes(configKey);
  }

  /**
   * returns name of bucket attatched to top-level config at configKey.
   * @param {string} configKey
   * @returns {string} name of bucket at key.
   */
  nameByKey(configKey: string) {
    return this.buckets[configKey].name;
  }

  /**
   * return a list of configured buckets of desired type.
   *
   * @param {string/Array} types - types of buckets to return
   * @returns {Array<Object>} - array of buckets that are of desired types
   */
  bucketsOfType(types: string | string[]) {
    const checkTypes = typeof types === 'string' ? [types] : types;

    return Object.values(this.buckets)
      .filter(({ type }) => checkTypes.includes(type));
  }

  /** @returns {Array} list of private buckets */
  privateBuckets() {
    return this.bucketsOfType('private');
  }

  /** @returns {Array} list of protected buckets */
  protectedBuckets() {
    return this.bucketsOfType('protected');
  }

  /** @returns {Array} list of public buckets */
  publicBuckets() {
    return this.bucketsOfType('public');
  }

  /** @returns {Array} list of shared buckets */
  sharedBuckets() {
    return this.bucketsOfType('shared');
  }

  /** @returns {Array} list of internal buckets */
  internalBuckets() {
    return this.bucketsOfType('internal');
  }
}

export = BucketsConfig;

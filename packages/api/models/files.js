'use strict';

const chunk = require('lodash.chunk');
const {
  DynamoDbSearchQueue,
  parseS3Uri
} = require('@cumulus/common/aws');
const Manager = require('./base');
const schemas = require('./schemas');

class FileClass extends Manager {
  constructor() {
    super({
      tableName: process.env.FilesTable,
      tableHash: { name: 'bucket', type: 'S' },
      tableRange: { name: 'key', type: 'S' },
      schema: schemas.file
    });
  }

  /**
   * Get the bucket and key from the file record. If the bucket
   * and key exist, use those, otherwise use the source to extract it
   *
   * @param {Object} file
   * @returns {Object} { bucket: 'bucket, key: 'key' }
   */
  getBucketAndKey(file) {
    let { bucket, key } = file;

    if (file.source && file.source.startsWith('s3')) {
      const { Bucket, Key } = parseS3Uri(file.source);
      bucket = bucket || Bucket;
      key = key || Key;
    }

    return { bucket, key };
  }

  /**
   * Create file records from a given granule record
   *
   * @param {Object} granule - the granule record
   * @param {Object<Array>} granule.files - Array of file objects
   * @returns {Promise<Array>} an array of promise responses from aws batchwrite
   */
  createFilesFromGranule(granule) {
    const fileRecords = (granule.files || [])
      .map((file) => {
        const { bucket, key } = this.getBucketAndKey(file);

        return {
          granuleId: granule.granuleId,
          bucket,
          key
        };
      })
      .filter((file) => file.bucket && file.key);

    const chunked = chunk(fileRecords, 25);
    return Promise.all(chunked.map((c) => this.batchWrite(null, c)));
  }

  /**
   * Delete file records associated with a given granule record
   *
   * @param {Object} granule - the granule record
   * @param {Object<Array>} granule.files - Array of file objects
   * @returns {Promise<Array>} an array of promise responses from aws batchwrite
   */
  deleteFilesOfGranule(granule) {
    const fileRecords = (granule.files || [])
      .map((file) => ({
        bucket: file.bucket,
        key: file.key
      }))
      .filter((file) => file.bucket && file.key);

    const chunked = chunk(fileRecords, 25);
    return Promise.all(chunked.map((c) => this.batchWrite(c)));
  }

  /**
   * Compares changes to the files of a granule before and after edit
   * and delete files that are removed from the granule on files table
   *
   * @param {Object} newGranule - the granule record after update
   * @param {Object<Array>} newGranule.files - Array of file objects
   * @param {Object} oldGranule - the granule record before update
   * @param {Object<Array>} oldGranule.files - Array of file objects
   * @returns {Promise<Array>} an array of promise responses from aws batchwrite
   */
  async deleteFilesAfterCompare(newGranule, oldGranule) {
    const buildFileId = (f) => `${f.bucket}/${f.key}`;

    let newFiles = (newGranule.files || []);
    let oldFiles = (oldGranule.files || []);

    // all we need is the bucket and key
    oldFiles = oldFiles.map((file) => this.getBucketAndKey(file));
    newFiles = newFiles.map((file) => this.getBucketAndKey(file));

    const newFilesIds = newFiles.map((f) => buildFileId(f));

    const filesToDelete = oldFiles
      .filter((oldFile) => !newFilesIds.includes(buildFileId(oldFile)));

    const chunkedFilesToDelete = chunk(filesToDelete, 25);
    return Promise.all(chunkedFilesToDelete.map((c) => this.batchWrite(c)));
  }

  /**
   * return the queue of the files for a given bucket,
   * the items should be ordered by the range key which is the bucket 'key' attribute
   *
   * @param {string} bucket - bucket name
   * @returns {Array<Object>} the files' queue for a given bucket
   */
  getFilesForBucket(bucket) {
    const params = {
      TableName: process.env.FilesTable,
      ExpressionAttributeNames: { '#b': 'bucket' },
      ExpressionAttributeValues: { ':bucket': bucket },
      FilterExpression: '#b = :bucket'
    };

    return new DynamoDbSearchQueue(params, 'scan');
  }
}

module.exports = FileClass;

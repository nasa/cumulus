'use strict';

const url = require('url');
const chunk = require('lodash.chunk');
const { DynamoDbSearchQueue } = require('@cumulus/common/aws');
const Manager = require('./base');
const schemas = require('./schemas');

/**
 * extract bucket and and s3 path from a give file object
 *
 * @param {Object} file - file object of a granule
 * @returns {Object} the bucket and key
 */
function extractFileInfo(file) {
  const parsed = url.parse(file.filename);
  let key = parsed.pathname;

  if (key.charAt(0) === '/') {
    key = key.substr(1);
  }
  return {
    bucket: parsed.hostname,
    key
  };
}

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
   * Create file records from a given granule record
   *
   * @param {Object} granule - the granule record
   * @param {Object<Array>} granule.files - Array of file objects
   * @returns {Promise<Array>} an array of promise responses from aws batchwrite
   */
  createFilesFromGranule(granule) {
    const fileRecords = [];
    if (granule.files) {
      granule.files.forEach((file) => {
        if (file.filename) {
          const extracted = extractFileInfo(file);
          fileRecords.push({
            granuleId: granule.granuleId,
            bucket: extracted.bucket,
            key: extracted.key
          });
        }
      });
    }

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
    const fileRecords = [];
    if (granule.files) {
      granule.files.forEach((file) => {
        if (file.filename) {
          const extracted = extractFileInfo(file);
          fileRecords.push({
            bucket: extracted.bucket,
            key: extracted.key
          });
        }
      });
    }

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
    if (oldGranule && oldGranule.files) {
      const currentFiles = {};
      if (newGranule.files) {
        newGranule.files.forEach((file) => {
          currentFiles[file.filename] = file;
        });
      }

      const filesToDelete = [];
      oldGranule.files.forEach((file) => {
        if (!currentFiles[file.filename]) {
          if (file.filename) {
            const extracted = extractFileInfo(file);
            filesToDelete.push({
              bucket: extracted.bucket,
              key: extracted.key
            });
          }
        }
      });

      const chunked = chunk(filesToDelete, 25);
      return Promise.all(chunked.map((c) => this.batchWrite(c)));
    }
    return [];
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

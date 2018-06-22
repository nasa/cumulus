'use strict';

const Manager = require('./base');
const chunk = require('lodash.chunk');

class FileClass extends Manager {
  constructor() {
    super(process.env.FilesTable);
  }

  /**
   * Create the dynamoDB for this class
   *
   * @returns {Promise} aws dynamodb createTable response
   */
  async createTable() {
    const hash = { name: 'bucket', type: 'S' };
    const range = { name: 'key', type: 'S' };
    return Manager.createTable(this.tableName, hash, range);
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
        fileRecords.push({
          granuleId: granule.granuleId,
          bucket: file.bucket,
          key: file.filepath
        });
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
        fileRecords.push({
          bucket: file.bucket,
          key: file.filepath
        });
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
          filesToDelete.push({
            bucket: file.bucket,
            key: file.filepath
          });
        }
      });

      const chunked = chunk(filesToDelete, 25);
      return Promise.all(chunked.map((c) => this.batchWrite(c)));
    }
    return [];
  }
}

module.exports = FileClass;

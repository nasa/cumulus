'use strict';

const chunk = require('lodash.chunk');
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
          key: file.key
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
    const granuleFiles = granule.files || [];

    const fileRecords = granuleFiles.map((f) => ({
      bucket: f.bucket,
      key: f.key
    }));

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
  deleteFilesAfterCompare(newGranule, oldGranule) {
    const buildFilePath = (f) => `${f.bucket}/${f.key}`;

    const newFilePaths = newGranule.files.map(buildFilePath);
    const oldGranuleFiles = oldGranule.files || [];

    const filesToDelete = oldGranuleFiles
      .filter((oldFile) => {
        const oldFilePath = buildFilePath(oldFile);

        return !newFilePaths.includes(oldFilePath);
      })
      .map((f) => ({ bucket: f.bucket, key: f.key }));

    const chunked = chunk(filesToDelete, 25);
    return Promise.all(chunked.map((c) => this.batchWrite(c)));
  }
}

module.exports = FileClass;

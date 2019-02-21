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
    const fileRecords = (granule.files || [])
      .map((file) => ({
        granuleId: granule.granuleId,
        bucket: file.bucket,
        key: file.key
      }));

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
  async deleteFilesAfterCompare(newGranule, oldGranule) {
    const buildFileId = (f) => `${f.bucket}/${f.key}`;

    const newFiles = (newGranule.files || []);
    const oldFiles = (oldGranule.files || []);

    const newFilesIds = newFiles.map(buildFileId);

    const filesToDelete = oldFiles
      .filter((oldFile) => !newFilesIds.includes(buildFileId(oldFile)))
      .map((oldFile) => ({ bucket: oldFile.bucket, key: oldFile.key }));

    const chunkedFilesToDelete = chunk(filesToDelete, 25);
    return Promise.all(chunkedFilesToDelete.map((c) => this.batchWrite(c)));
  }
}

module.exports = FileClass;

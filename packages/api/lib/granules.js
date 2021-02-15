'use strict';

const awsClients = require('@cumulus/aws-client/services');
const isInteger = require('lodash/isInteger');
const isNil = require('lodash/isNil');
const { deleteS3Object } = require('@cumulus/aws-client/S3');
const { GranulePgModel, FilePgModel } = require('@cumulus/db');
const { CMR } = require('@cumulus/cmr-client');
const log = require('@cumulus/common/log');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');
const pMap = require('p-map');

const Granule = require('../models/granules');
const { CumulusModelError } = require('./errors');
const FileUtils = require('./FileUtils');

const translateGranule = async (
  granule,
  fileUtils = FileUtils
) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await fileUtils.buildDatabaseFiles({
      s3: awsClients.s3(),
      files: granule.files,
    }),
  };
};

const getExecutionProcessingTimeInfo = ({
  startDate,
  stopDate,
  now = new Date(),
}) => {
  const processingTimeInfo = {};
  if (startDate) {
    processingTimeInfo.processingStartDateTime = startDate.toISOString();
    processingTimeInfo.processingEndDateTime = stopDate
      ? stopDate.toISOString()
      : now.toISOString();
  }
  return processingTimeInfo;
};

/* eslint-disable camelcase */

const getGranuleTimeToPreprocess = ({
  sync_granule_duration = 0,
} = {}) => sync_granule_duration / 1000;

const getGranuleTimeToArchive = ({
  post_to_cmr_duration = 0,
} = {}) => post_to_cmr_duration / 1000;

/* eslint-enable camelcase */

/**
 * Calculate granule product volume, which is the sum of the file
 * sizes in bytes
 *
 * @param {Array<Object>} granuleFiles - array of granule files
 * @returns {Integer} - sum of granule file sizes in bytes
 */
function getGranuleProductVolume(granuleFiles = []) {
  return granuleFiles
    .map((f) => f.size)
    .filter(isInteger)
    .reduce((x, y) => x + y, 0);
}

/**
 * Delete a Granule from Postgres and Dynamo, delete the Granule's
 * Files from Postgres and S3
 *
 * @param {Object} params
 * @param {Knex} params.knex - DB client
 * @param {Object} params.dynamoGranule - Granule from DynamoDB
 * @param {PostgresGranule} params.pgGranule - Granule from Postgres
 * @param {FilePgModel} params.filePgModel - File Postgres model
 * @param {GranulePgModel} params.granulePgModel - Granule Postgres model
 * @param {Object} params.granuleModelClient - Granule Dynamo model
 */
const deleteGranuleAndFiles = async ({
  knex,
  dynamoGranule,
  pgGranule,
  filePgModel = new FilePgModel(),
  granulePgModel = new GranulePgModel(),
  granuleModelClient = new Granule(),
}) => {
  if (pgGranule === undefined) {
    // Delete only the Dynamo Granule and S3 Files
    await granuleModelClient.delete(dynamoGranule);
  } else {
    // Delete PG Granule, PG Files, Dynamo Granule, S3 Files
    const files = await filePgModel.search(
      knex,
      { granule_cumulus_id: pgGranule.cumulus_id }
    );

    await knex.transaction(async (trx) => {
      await pMap(
        files,
        (file) => {
          filePgModel.delete(trx, { cumulus_id: file.cumulus_id });
        }
      );

      await granulePgModel.delete(trx, pgGranule);
      await granuleModelClient.delete(dynamoGranule);
    });

    await pMap(
      files,
      (file) => {
        deleteS3Object(
          FileUtils.getBucket(file),
          FileUtils.getKey(file)
        );
      }
    );
  }
};

/**
 * Remove granule record from CMR
 *
 * @param {Object} granule - A granule record
 * @throws {CumulusModelError|Error}
 * @returns {Promise}
 * @private
 */
const removeGranuleFromCmr = async (granule) => {
  log.info(`granules.removeGranuleFromCmrByGranule ${granule.granuleId}`);

  if (!granule.published || !granule.cmrLink) {
    throw new CumulusModelError(`Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
  }

  const cmrSettings = await cmrjsCmrUtils.getCmrSettings();
  const cmr = new CMR(cmrSettings);
  const metadata = await cmr.getGranuleMetadata(granule.cmrLink);

  // Use granule UR to delete from CMR
  await cmr.deleteGranule(metadata.title, granule.collectionId);
};

module.exports = {
  translateGranule,
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
  deleteGranuleAndFiles,
  removeGranuleFromCmr,
};

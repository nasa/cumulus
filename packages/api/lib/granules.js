'use strict';

const awsClients = require('@cumulus/aws-client/services');
const isInteger = require('lodash/isInteger');
const isNil = require('lodash/isNil');
const { deleteS3Object } = require('@cumulus/aws-client/S3');
const pMap = require('p-map');

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

// TODO default arguments
const deleteGranuleAndFiles = async (
  knex,
  dynamoGranule,
  pgGranule,
  filePgModel,
  granulePgModel,
  granuleModelClient
) => {
  const files = await knex(filePgModel.tableName)
    .where({ granule_cumulus_id: pgGranule.cumulus_id });

  await knex.transaction(async (trx) => {
    await pMap(
      files,
      (file) =>
        knex.transaction(async (fileTrx) => {
          await filePgModel.delete(fileTrx, { cumulus_id: file.cumulus_id });
          await deleteS3Object(file.bucket, file.key);
        })
    );
    await granulePgModel.delete(trx, pgGranule);
    await granuleModelClient.delete(dynamoGranule);
  });
};

module.exports = {
  translateGranule,
  getExecutionProcessingTimeInfo,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getGranuleProductVolume,
  deleteGranuleAndFiles,
};

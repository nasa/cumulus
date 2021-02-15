const { deleteS3Object } = require('@cumulus/aws-client/S3');
const { GranulePgModel, FilePgModel } = require('@cumulus/db');
const pMap = require('p-map');

const FileUtils = require('./FileUtils');
const Granule = require('../models/granules');

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

module.exports = {
  deleteGranuleAndFiles,
};

import Knex from 'knex';
import pMap from 'p-map';

import { deleteS3Object } from '@cumulus/aws-client/S3';
import {
  GranulePgModel,
  FilePgModel,
  PostgresGranuleRecord,
  PostgresFileRecord,
} from '@cumulus/db';
import { DeletePublishedGranule } from '@cumulus/errors';
import { ApiFile, ApiGranule } from '@cumulus/types';

const FileUtils = require('../../lib/FileUtils');
const Granule = require('../../models/granules');

/**
 * Delete a list of files from S3
 *
 * @param {Array} files - A list of S3 files
 * @returns {Promise}
 */
const _deleteS3Files = async (
  files: (ApiFile | PostgresFileRecord)[] = []
) =>
  pMap(
    files,
    (file) => {
      deleteS3Object(
        FileUtils.getBucket(file),
        FileUtils.getKey(file)
      );
    }
  );

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
}: {
  knex: Knex,
  dynamoGranule: ApiGranule,
  pgGranule: PostgresGranuleRecord,
  filePgModel: FilePgModel,
  granulePgModel: GranulePgModel,
  granuleModelClient: typeof Granule
}) => {
  if (pgGranule === undefined) {
    // Delete only the Dynamo Granule and S3 Files
    await _deleteS3Files(dynamoGranule.files);
    await granuleModelClient.delete(dynamoGranule);
  } else if (pgGranule.published) {
    throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
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

      // TODO: relying on the cumulus_id from the lookup is icky, but we need to
      // truly identify the unique record.
      await granulePgModel.delete(trx, {
        granule_id: pgGranule.granule_id,
        collection_cumulus_id: pgGranule.collection_cumulus_id,
        // cumulus_id: pgGranule.cumulus_id,
      });
      await granuleModelClient.delete(dynamoGranule);
    });

    await _deleteS3Files(files);
  }
};

module.exports = {
  deleteGranuleAndFiles,
};

import { Knex } from 'knex';
import pMap from 'p-map';

import { deleteS3Object } from '@cumulus/aws-client/S3';
import {
  FilePgModel,
  GranulePgModel,
  PostgresGranuleRecord,
  PostgresFileRecord,
  createRejectableTransaction,
  translatePostgresGranuleToApiGranule,
  CollectionPgModel,
  PdrPgModel,
  ProviderPgModel,
} from '@cumulus/db';
import { DeletePublishedGranule } from '@cumulus/errors';
import { ApiGranule, ApiFile } from '@cumulus/types';
import Logger from '@cumulus/logger';

const { deleteGranule } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { publishGranuleDeleteSnsMessage } = require('../../lib/publishSnsMessageUtils');
const FileUtils = require('../../lib/FileUtils');
const Granule = require('../../models/granules');

const logger = new Logger({ sender: '@cumulus/api/granule-delete' });

/**
 * Delete a list of files from S3
 *
 * @param {Array} files - A list of S3 files
 * @returns {Promise<void>}
 */
const deleteS3Files = async (
  files: (Omit<ApiFile, 'granuleId'> | PostgresFileRecord)[] = [] // TODO: do we still need API File?
) =>
  await pMap(
    files,
    async (file) => {
      await deleteS3Object(
        FileUtils.getBucket(file),
        FileUtils.getKey(file)
      );
    }
  );

/**
 * Delete a Granule from Postgres and/or ES, delete the Granule's
 * Files from Postgres and S3
 *
 * @param {Object} params
 * @param {Knex} params.knex - DB client
 * @param {Object} params.dynamoGranule - Granule from DynamoDB
 * @param {PostgresGranule} params.pgGranule - Granule from Postgres
 * @param {number | undefined} params.collectionCumulusId - Optional Collection Cumulus ID
 * @param {FilePgModel} params.filePgModel - File Postgres model
 * @param {GranulePgModel} params.granulePgModel - Granule Postgres model
 * @param {CollectionPgModel} params.collectionPgModel - Collection Postgres model
 * @param {Object} params.granuleModelClient - Granule Dynamo model
 */
const deleteGranuleAndFiles = async (params: {
  knex: Knex,
  apiGranule?: ApiGranule,
  pgGranule: PostgresGranuleRecord,
  filePgModel: FilePgModel,
  granulePgModel: GranulePgModel,
  collectionPgModel: CollectionPgModel,
  granuleModelClient: typeof Granule,
  esClient: {
    delete(...args: any): any | any[];
  },
  collectionCumulusId?: number,
}) => {
  const {
    knex,
    pgGranule,
    apiGranule,
    filePgModel = new FilePgModel(),
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    esClient = await Search.es(),
  } = params;

  // Most of the calls using this method aren't typescripted
  // We cannot rely on typings to save us here
  if (!pgGranule && !apiGranule) {
    throw new Error('pgGranule and apiGranule undefined, but one is required');
  }
  if (!pgGranule && apiGranule) {
    logger.info('deleteGranuleAndFiles called without pgGranule, removing ES record only');
    await deleteGranule({
      esClient,
      granuleId: apiGranule.granuleId,
      collectionId: apiGranule.collectionId,
      index: process.env.ES_INDEX,
      ignore: [404],
    });
    logger.debug(`Successfully deleted granule ${apiGranule.granuleId} from ES datastore`);
    await deleteS3Files(apiGranule.files);
    logger.debug(`Successfully removed S3 files ${JSON.stringify(apiGranule.files)}`);
    return;
  }
  if (pgGranule.published) {
    throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
  }
  // Delete PG Granule, PG Files, S3 Files
  logger.debug(`Initiating deletion of PG granule ${JSON.stringify(pgGranule)}`);
  const files = await filePgModel.search(
    knex,
    { granule_cumulus_id: pgGranule.cumulus_id }
  );

  const granuleToPublishToSns = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
    collectionPgModel,
    filePgModel,
    pdrPgModel: new PdrPgModel(),
    providerPgModel: new ProviderPgModel(),
  });

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await granulePgModel.delete(trx, {
        cumulus_id: pgGranule.cumulus_id,
      });
      await deleteGranule({
        esClient,
        granuleId: granuleToPublishToSns.granuleId,
        collectionId: granuleToPublishToSns.collectionId,
        index: process.env.ES_INDEX,
        ignore: [404],
      });
    });
    await publishGranuleDeleteSnsMessage(granuleToPublishToSns);
    logger.debug(`Successfully deleted granule ${pgGranule.granule_id} from ES/PostGreSQL datastores`);
    await deleteS3Files(files);
    logger.debug(`Successfully removed S3 files ${JSON.stringify(files)}`);
  } catch (error) {
    logger.debug(`Error deleting granule with ID ${pgGranule.granule_id} or S3 files ${JSON.stringify(files)}: ${JSON.stringify(error)}`);
    throw error;
  }
};

module.exports = {
  deleteGranuleAndFiles,
};

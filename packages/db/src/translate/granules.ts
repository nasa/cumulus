import Knex from 'knex';

import { constructCollectionId, deconstructCollectionId } from '@cumulus/message/Collections';
import { ApiGranule } from '@cumulus/types/api/granules';

import { CollectionPgModel } from '../models/collection';
import { PdrPgModel } from '../models/pdr';
import { PostgresGranule } from '../types/granule';
import { ProviderPgModel } from '../models/provider';
import { FilePgModel } from '../models/file';
import { ExecutionPgModel } from '../models/execution';

/**
 * Generate a Postgres granule record from a DynamoDB record.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex | Knex.Transaction} knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} pdrPgModel - Instance of the pdr database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @returns {Object} A granule PG record
 */
export const translateApiGranuleToPostgresGranule = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<PostgresGranule> => {
  const { name, version } = deconstructCollectionId(dynamoRecord.collectionId);
  const granuleRecord: PostgresGranule = {
    granule_id: dynamoRecord.granuleId,
    status: dynamoRecord.status,
    collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
      knexOrTransaction,
      { name, version }
    ),
    published: dynamoRecord.published,
    duration: dynamoRecord.duration,
    time_to_archive: dynamoRecord.timeToArchive,
    time_to_process: dynamoRecord.timeToPreprocess,
    product_volume: dynamoRecord.productVolume,
    error: dynamoRecord.error,
    cmr_link: dynamoRecord.cmrLink,
    pdr_cumulus_id: dynamoRecord.pdrName
      ? await pdrPgModel.getRecordCumulusId(
        knexOrTransaction,
        { name: dynamoRecord.pdrName }
      )
      : undefined,
    provider_cumulus_id: dynamoRecord.provider ? await providerPgModel.getRecordCumulusId(
      knexOrTransaction,
      { name: dynamoRecord.provider }
    ) : undefined,
    query_fields: dynamoRecord.queryFields,
    beginning_date_time: dynamoRecord.beginningDateTime
      ? new Date(dynamoRecord.beginningDateTime) : undefined,
    ending_date_time: dynamoRecord.endingDateTime
      ? new Date(dynamoRecord.endingDateTime) : undefined,
    last_update_date_time: dynamoRecord.lastUpdateDateTime
      ? new Date(dynamoRecord.lastUpdateDateTime) : undefined,
    processing_end_date_time: dynamoRecord.processingEndDateTime
      ? new Date(dynamoRecord.processingEndDateTime) : undefined,
    processing_start_date_time: dynamoRecord.processingStartDateTime
      ? new Date(dynamoRecord.processingStartDateTime) : undefined,
    production_date_time: dynamoRecord.productionDateTime
      ? new Date(dynamoRecord.productionDateTime) : undefined,
    timestamp: dynamoRecord.timestamp
      ? new Date(dynamoRecord.timestamp) : undefined,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };

  return granuleRecord;
};

/**
 * Generate an API Granule record from a PostgreSQL record.
 *
 * @param {Object} postgresGranule - A PostgreSQL Granule record
 * @param {Knex | Knex.Transaction} knex
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} filePgModel - Instance of the file database model
 * @param {Object} pdrPgModel - Instance of the pdr database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} executionPgModel - Instance of the execution database model
 * @returns {Object} A granule API record
 */
export const translatePostgresGranuleToApiGranule = async (
  postgresGranule: PostgresGranuleRecord,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  filePgModel = new FilePgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<ApiGranule> => {
  let collectionId;
  let provider: string | undefined;
  let pdrName: string | undefined;

  if (postgresGranule.collection_cumulus_id) {
    const collection = await collectionPgModel.get(knex, {
      cumulus_id: postgresGranule.collection_cumulus_id,
    });
    collectionId = constructCollectionId(collection.name, collection.version);
  }

  if (postgresGranule.provider_cumulus_id) {
    const pgProvider = await providerPgModel.get(knex, {
      cumulus_id: postgresGranule.provider_cumulus_id,
    });
    provider = pgProvider.name;
  }

  if (postgresGranule.pdr_cumulus_id) {
    const pdr = await pdrPgModel.get(knex, {
      cumulus_id: postgresGranule.pdr_cumulus_id,
    });
    pdrName = pdr.name;
  }

  const files = await filePgModel.search(knex, {
    granule_cumulus_id: postgresGranule.cumulus_id,
  });
  const execution = await executionPgModel.search(knex, {
    granule_cumulus_id: postgresGranule.cumulus_id,
  });
  const apiGranule = {
    granuleId: postgresGranule.granule_id,
    collectionId,
    status: postgresGranule.status,
    execution: execution,
    cmrLink: postgresGranule.cmr_link,
    published: postgresGranule.published,
    pdrName,
    provider,
    error: postgresGranule.error,
    createdAt: postgresGranule.created_at?.getTime(),
    timestamp: postgresGranule.timestamp?.getTime(),
    updatedAt: postgresGranule.updated_at?.getTime(),
    duration: postgresGranule.duration,
    productVolume: postgresGranule.product_volume,
    timeToPreprocess: postgresGranule.time_to_process,
    timeToArchive: postgresGranule.time_to_archive,
    files,
  };
  return apiGranule;
};

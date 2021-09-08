import Knex from 'knex';

import { deconstructCollectionId, constructCollectionId } from '@cumulus/message/Collections';
import { getExecutionUrlFromArn } from '@cumulus/message/Executions';
import { ApiGranule, GranuleStatus } from '@cumulus/types/api/granules';
import { removeNilProperties } from '@cumulus/common/util';
import { ValidationError } from '@cumulus/errors';

import { CollectionPgModel } from '../models/collection';
import { PdrPgModel } from '../models/pdr';
import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';
import { ProviderPgModel } from '../models/provider';
import { FilePgModel } from '../models/file';
import { translatePostgresFileToApiFile } from './file';
import { getExecutionArnsByGranuleCumulusId } from '../lib/execution';
import { PostgresCollectionRecord } from '../types/collection';

/**
 * Generate an API Granule object from a Postgres Granule with associated Files.
 *
 * @param {Object} params
 * @param {PostgresGranuleRecord} params.granulePgRecord - Granule from Postgres
 * @param {PostgresCollectionRecord} params.collectionPgRecord - Collection from Postgres
 * @param {Knex | Knex.Transaction} params.knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Object} params.collectionPgModel - Instance of the collection database model
 * @param {Object} params.pdrPgModel - Instance of the pdr database model
 * @param {Object} params.providerPgModel - Instance of the provider database model
 * @param {Object} params.filePgModel - Instance of the file database model
 * @param {Object} params.executionPgModel - Instance of the execution database model
 * @returns {Object} An API Granule with associated Files
 */
export const translatePostgresGranuleToApiGranule = async ({
  granulePgRecord,
  collectionPgRecord,
  knexOrTransaction,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
  filePgModel = new FilePgModel(),
}: {
  granulePgRecord: PostgresGranuleRecord,
  collectionPgRecord: PostgresCollectionRecord,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel: CollectionPgModel,
  pdrPgModel: PdrPgModel,
  providerPgModel: ProviderPgModel,
  filePgModel: FilePgModel,
}): Promise<ApiGranule> => {
  const collection = collectionPgRecord || await collectionPgModel.get(
    knexOrTransaction, { cumulus_id: granulePgRecord.collection_cumulus_id }
  );

  if (granulePgRecord.collection_cumulus_id !== collection.cumulus_id) {
    throw new ValidationError(`Collection ${collection.cumulus_id} does not match the Granule's Collection ${granulePgRecord.collection_cumulus_id}`);
  }

  const files = await filePgModel.search(
    knexOrTransaction, { granule_cumulus_id: granulePgRecord.cumulus_id }
  );
  const executionArns = await getExecutionArnsByGranuleCumulusId(
    knexOrTransaction,
    granulePgRecord.cumulus_id,
    1
  );

  let pdr;

  if (granulePgRecord.pdr_cumulus_id) {
    pdr = await pdrPgModel.get(
      knexOrTransaction, { cumulus_id: granulePgRecord.pdr_cumulus_id }
    );
  }

  let provider;

  if (granulePgRecord.provider_cumulus_id) {
    provider = await providerPgModel.get(
      knexOrTransaction, { cumulus_id: granulePgRecord.provider_cumulus_id }
    );
  }

  const apiGranule: ApiGranule = removeNilProperties({
    beginningDateTime: granulePgRecord.beginning_date_time?.getTime().toString(),
    cmrLink: granulePgRecord.cmr_link,
    collectionId: constructCollectionId(collection.name, collection.version),
    createdAt: granulePgRecord.created_at?.getTime(),
    duration: granulePgRecord.duration,
    endingDateTime: granulePgRecord.ending_date_time?.getTime().toString(),
    error: granulePgRecord.error,
    execution: executionArns[0] ? getExecutionUrlFromArn(executionArns[0].arn) : undefined,
    files: files.map((file) => ({
      ...translatePostgresFileToApiFile(file),
    })),
    granuleId: granulePgRecord.granule_id,
    lastUpdateDateTime: granulePgRecord.last_update_date_time?.getTime().toString(),
    pdrName: pdr ? pdr.name : undefined,
    processingEndDateTime: granulePgRecord.processing_end_date_time?.getTime().toString(),
    processingStartDateTime: granulePgRecord.processing_start_date_time?.getTime().toString(),
    productionDateTime: granulePgRecord.production_date_time?.getTime().toString(),
    productVolume: granulePgRecord.product_volume
      ? Number.parseInt(granulePgRecord.product_volume, 10) : undefined,
    provider: provider ? provider.name : undefined,
    published: granulePgRecord.published,
    queryFields: granulePgRecord.query_fields,
    status: granulePgRecord.status as GranuleStatus,
    timestamp: granulePgRecord.timestamp?.getTime(),
    timeToArchive: granulePgRecord.time_to_archive,
    timeToPreprocess: granulePgRecord.time_to_process,
    updatedAt: granulePgRecord.updated_at?.getTime(),
  });

  return apiGranule;
};

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

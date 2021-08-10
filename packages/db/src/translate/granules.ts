import Knex from 'knex';

import { deconstructCollectionId, constructCollectionId } from '@cumulus/message/Collections';
import { removeNilProperties } from '@cumulus/common/util';

import { CollectionPgModel } from '../models/collection';
import { PdrPgModel } from '../models/pdr';
import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';
import { ProviderPgModel } from '../models/provider';
import { FilePgModel } from '../models/file';
import { translatePostgresFileToApiFile } from './file';
import { getExecutionArnsByGranuleCumulusId } from '../lib/execution';

/**
 * Generate an API Granule object from a Postgres Granule with associated Files.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} granulePgRecord
 *   Granule from Postgres
 * @param {Knex | Knex.Transaction} knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} pdrPgModel - Instance of the pdr database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} filePgModel - Instance of the file database model
 * @param {Object} executionPgModel - Instance of the execution database model
 * @returns {Object} An API Granule with associated Files
 */
export const translatePostgresGranuleToApiGranule = async (
  granulePgRecord: PostgresGranuleRecord,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
  filePgModel = new FilePgModel()
): Promise<AWS.DynamoDB.DocumentClient.AttributeMap> => {
  const collection = await collectionPgModel.get(
    knexOrTransaction, { cumulus_id: granulePgRecord.collection_cumulus_id }
  );
  const pdr = await pdrPgModel.get(
    knexOrTransaction, { cumulus_id: granulePgRecord.pdr_cumulus_id }
  );
  const provider = await providerPgModel.get(
    knexOrTransaction, { cumulus_id: granulePgRecord.provider_cumulus_id }
  );
  const files = await filePgModel.search(
    knexOrTransaction, { granule_cumulus_id: granulePgRecord.cumulus_id }
  );
  const executionArns = await getExecutionArnsByGranuleCumulusId(
    knexOrTransaction,
    granulePgRecord.cumulus_id
  );

  return removeNilProperties(({
    granuleId: granulePgRecord.granule_id,
    status: granulePgRecord.status,
    collectionId: constructCollectionId(collection.name, collection.version),
    published: granulePgRecord.published,
    duration: granulePgRecord.duration,
    timeToArchive: granulePgRecord.time_to_archive,
    timeToPreprocess: granulePgRecord.time_to_process,
    productVolume: granulePgRecord.product_volume,
    error: granulePgRecord.error,
    cmrLink: granulePgRecord.cmr_link,
    pdrName: pdr.name,
    provider: provider.name,
    queryFields: granulePgRecord.query_fields,
    beginningDateTime: granulePgRecord.beginning_date_time?.getTime(),
    endingDateTime: granulePgRecord.ending_date_time?.getTime(),
    lastUpdateDateTime: granulePgRecord.last_update_date_time?.getTime(),
    processingEndDateTime: granulePgRecord.processing_end_date_time?.getTime(),
    processingStartDateTime: granulePgRecord.processing_start_date_time?.getTime(),
    productionDateTime: granulePgRecord.production_date_time?.getTime(),
    timestamp: granulePgRecord.timestamp?.getTime(),
    createdAt: granulePgRecord.created_at?.getTime(),
    updatedAt: granulePgRecord.updated_at?.getTime(),
    files: files.map((file) => translatePostgresFileToApiFile(file)),
    executions: executionArns,
  }));
};

/**
 * Generate a Postgres Granule from a DynamoDB Granule.
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

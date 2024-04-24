import { Knex } from 'knex';

import { deconstructCollectionId, constructCollectionId } from '@cumulus/message/Collections';
import { ApiGranule, ApiGranuleRecord, GranuleStatus } from '@cumulus/types/api/granules';
import { removeNilProperties, returnNullOrUndefinedOrDate } from '@cumulus/common/util';
import { ValidationError } from '@cumulus/errors';
import isNil from 'lodash/isNil';
import isNull from 'lodash/isNull';

import { CollectionPgModel } from '../models/collection';
import { PdrPgModel } from '../models/pdr';
import { ProviderPgModel } from '../models/provider';
import { FilePgModel } from '../models/file';

import { getExecutionInfoByGranuleCumulusId } from '../lib/execution';
import { PostgresCollectionRecord } from '../types/collection';
import { PostgresExecutionRecord } from '../types/execution';
import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';
import { PostgresFileRecord } from '../types/file';
import { PostgresPdrRecord } from '../types/pdr';
import { GranuleWithProviderAndCollectionInfo } from '../types/query';
import { PostgresProviderRecord } from '../types/provider';

import { translatePostgresFileToApiFile } from './file';

export const translatePostgresGranuleToApiGranuleWithoutDbQuery = ({
  granulePgRecord,
  collectionPgRecord,
  executionUrls = [],
  files = [],
  pdr,
  providerPgRecord,
}: {
  granulePgRecord: PostgresGranuleRecord,
  collectionPgRecord: Pick<PostgresCollectionRecord, 'cumulus_id' | 'name' | 'version'>,
  executionUrls?: Partial<PostgresExecutionRecord>[],
  files?: PostgresFileRecord[],
  pdr?: PostgresPdrRecord,
  providerPgRecord?: Pick<PostgresProviderRecord, 'name'>,
}): ApiGranuleRecord => removeNilProperties({
  beginningDateTime: granulePgRecord.beginning_date_time?.toISOString(),
  cmrLink: granulePgRecord.cmr_link,
  collectionId: constructCollectionId(collectionPgRecord.name, collectionPgRecord.version),
  createdAt: granulePgRecord.created_at?.getTime(),
  duration: granulePgRecord.duration,
  endingDateTime: granulePgRecord.ending_date_time?.toISOString(),
  error: granulePgRecord.error,
  execution: executionUrls[0] ? executionUrls[0].url : undefined,
  files: files.length > 0 ? files.map((file) => translatePostgresFileToApiFile(file)) : [],
  granuleId: granulePgRecord.granule_id,
  lastUpdateDateTime: granulePgRecord.last_update_date_time?.toISOString(),
  pdrName: pdr ? pdr.name : undefined,
  processingEndDateTime: granulePgRecord.processing_end_date_time?.toISOString(),
  processingStartDateTime: granulePgRecord.processing_start_date_time?.toISOString(),
  productionDateTime: granulePgRecord.production_date_time?.toISOString(),
  productVolume: granulePgRecord.product_volume,
  provider: providerPgRecord ? providerPgRecord.name : undefined,
  published: granulePgRecord.published,
  queryFields: granulePgRecord.query_fields,
  status: granulePgRecord.status as GranuleStatus,
  timestamp: granulePgRecord.timestamp?.getTime(),
  timeToArchive: granulePgRecord.time_to_archive,
  timeToPreprocess: granulePgRecord.time_to_process,
  updatedAt: granulePgRecord.updated_at?.getTime(),
});

/**
 * Generate an API Granule object from a Postgres Granule with associated Files.
 *
 * @param {Object} params
 * @param {PostgresGranuleRecord} params.granulePgRecord - Granule from Postgres
 * @param {PostgresCollectionRecord} [params.collectionPgRecord] - Optional Collection from Postgres
 * @param {Knex | Knex.Transaction} params.knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Object} [params.collectionPgModel] - Instance of the collection database model
 * @param {Object} [params.pdrPgModel] - Instance of the pdr database model
 * @param {Object} [params.providerPgModel] - Instance of the provider database model
 * @param {Object} [params.filePgModel] - Instance of the file database model
 * @returns {Object} An API Granule with associated Files
 */
export const translatePostgresGranuleToApiGranule = async ({
  granulePgRecord,
  collectionPgRecord,
  knexOrTransaction,
  providerPgRecord,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
  filePgModel = new FilePgModel(),
}: {
  granulePgRecord: PostgresGranuleRecord,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgRecord?: Pick<PostgresCollectionRecord, 'cumulus_id' | 'name' | 'version'>,
  providerPgRecord?: Pick<PostgresProviderRecord, 'name'>,
  collectionPgModel?: CollectionPgModel,
  pdrPgModel?: PdrPgModel,
  providerPgModel?: ProviderPgModel,
  filePgModel?: FilePgModel,
}): Promise<ApiGranuleRecord> => {
  const collection = collectionPgRecord || await collectionPgModel.get(
    knexOrTransaction, { cumulus_id: granulePgRecord.collection_cumulus_id }
  );

  if (granulePgRecord.collection_cumulus_id !== collection.cumulus_id) {
    throw new ValidationError(`Input collection.cumulus_id: ${collection.cumulus_id} does not match the granule PG record collection_cumulus_id: ${granulePgRecord.collection_cumulus_id}`);
  }

  const files = await filePgModel.search(
    knexOrTransaction,
    { granule_cumulus_id: granulePgRecord.cumulus_id }
  );
  const executionUrls = await getExecutionInfoByGranuleCumulusId({
    knexOrTransaction,
    granuleCumulusId: granulePgRecord.cumulus_id,
    executionColumns: ['url'],
    limit: 1,
  });

  let pdr;
  if (granulePgRecord.pdr_cumulus_id) {
    pdr = await pdrPgModel.get(
      knexOrTransaction, { cumulus_id: granulePgRecord.pdr_cumulus_id }
    );
  }

  let provider;
  if (providerPgRecord) {
    provider = providerPgRecord;
  } else if (granulePgRecord.provider_cumulus_id) {
    provider = await providerPgModel.get(
      knexOrTransaction, { cumulus_id: granulePgRecord.provider_cumulus_id }
    );
  }

  return translatePostgresGranuleToApiGranuleWithoutDbQuery({
    granulePgRecord,
    collectionPgRecord: collection,
    executionUrls,
    files,
    pdr,
    providerPgRecord: provider,
  });
};

/**
 * Validate translation request doesn't contain invalid null files based
 * on onPostgresGranule typings.  Throw if invalid nulls detected
 *
 * @param {Object} params
 * @param {ApiGranule} apiGranule
 *   Record from DynamoDB
 * @returns {undefined}
 */
const validateApiToPostgresGranuleObject = (apiGranule : ApiGranule) => {
  if (isNil(apiGranule.collectionId)) {
    throw new ValidationError('collectionId cannot be undefined on a granule, granules must have a collection and a granule ID');
  }
  if (isNil(apiGranule.granuleId)) {
    throw new ValidationError('granuleId cannot be undefined on a granule, granules must have a collection and a granule ID');
  }
  if (isNull(apiGranule.status)) {
    throw new ValidationError('status cannot be null on a granule, granules must have a collection and a granule ID');
  }
};

/**
 * Generate a Postgres granule record from a DynamoDB record.
 *
 * @param {Object} params
 * @param {ApiGranule} params.dynamoRecord
 *   Record from DynamoDB
 * @param {Knex | Knex.Transaction} params.knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {CollectionPgModel} params.collectionPgModel - Instance of the collection database model
 * @param {PdrPgModel} params.pdrPgModel - Instance of the pdr database model
 * @param {ProviderPgModel} params.providerPgModel - Instance of the provider database model
 * @returns {PostgresGranule} A granule PG record
 */
export const translateApiGranuleToPostgresGranuleWithoutNilsRemoved = async ({
  dynamoRecord,
  knexOrTransaction,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
}: {
  dynamoRecord: ApiGranule,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel?: CollectionPgModel,
  pdrPgModel?: PdrPgModel,
  providerPgModel?: ProviderPgModel,
}): Promise<PostgresGranule> => {
  // Invalid Null values should be validated as the primary use in Core
  // is the non-typescripted API package.
  validateApiToPostgresGranuleObject(dynamoRecord);

  const { name, version } = deconstructCollectionId(dynamoRecord.collectionId);

  // eslint-disable-next-line @typescript-eslint/naming-convention
  let pdr_cumulus_id;
  if (isNil(dynamoRecord.pdrName)) {
    pdr_cumulus_id = dynamoRecord.pdrName;
  } else {
    pdr_cumulus_id = await pdrPgModel.getRecordCumulusId(knexOrTransaction, {
      name: dynamoRecord.pdrName,
    });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  let provider_cumulus_id : null | undefined | number;
  if (isNil(dynamoRecord.provider)) {
    provider_cumulus_id = dynamoRecord.provider;
  } else {
    provider_cumulus_id = await providerPgModel.getRecordCumulusId(
      knexOrTransaction,
      { name: dynamoRecord.provider }
    );
  }

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
    product_volume: isNil(dynamoRecord.productVolume)
      ? dynamoRecord.productVolume
      : dynamoRecord.productVolume,
    error: dynamoRecord.error,
    cmr_link: dynamoRecord.cmrLink,
    pdr_cumulus_id,
    provider_cumulus_id,
    query_fields: dynamoRecord.queryFields,
    beginning_date_time: returnNullOrUndefinedOrDate(dynamoRecord.beginningDateTime),
    ending_date_time: returnNullOrUndefinedOrDate(dynamoRecord.endingDateTime),
    last_update_date_time: returnNullOrUndefinedOrDate(dynamoRecord.lastUpdateDateTime),
    processing_end_date_time: returnNullOrUndefinedOrDate(dynamoRecord.processingEndDateTime),
    processing_start_date_time: returnNullOrUndefinedOrDate(dynamoRecord.processingStartDateTime),
    production_date_time: returnNullOrUndefinedOrDate(dynamoRecord.productionDateTime),
    timestamp: returnNullOrUndefinedOrDate(dynamoRecord.timestamp),
    created_at: returnNullOrUndefinedOrDate(dynamoRecord.createdAt),
    updated_at: returnNullOrUndefinedOrDate(dynamoRecord.updatedAt),
  };

  return granuleRecord;
};

/**
 * Generate a Postgres granule record from a DynamoDB record. Removes
 *   any null/undefined properties.
 *
 * @param {Object} params
 * @param {ApiGranule} params.dynamoRecord
 *   Record from DynamoDB
 * @param {Knex | Knex.Transaction} params.knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {CollectionPgModel} params.collectionPgModel - Instance of the collection database model
 * @param {PdrPgModel} params.pdrPgModel - Instance of the pdr database model
 * @param {ProviderPgModel} params.providerPgModel - Instance of the provider database model
 * @returns {PostgresGranule} A granule PG record with null/undefined properties removed
 */
export const translateApiGranuleToPostgresGranule = async ({
  dynamoRecord,
  knexOrTransaction,
  collectionPgModel = new CollectionPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
}: {
  dynamoRecord: ApiGranule,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel?: CollectionPgModel,
  pdrPgModel?: PdrPgModel,
  providerPgModel?: ProviderPgModel,
}): Promise<PostgresGranule> => removeNilProperties(
  await translateApiGranuleToPostgresGranuleWithoutNilsRemoved({
    dynamoRecord,
    knexOrTransaction,
    collectionPgModel,
    pdrPgModel,
    providerPgModel,
  })
);

/**
 * Translate a custom database result into an API granule
 *
 * @param {Knex | Knex.Transaction} knex
 *   Knex client for reading from RDS database
 * @param {GranuleWithProviderAndCollectionInfo} dbResult - Custom database result
 */
export const translatePostgresGranuleResultToApiGranule = async (
  knex: Knex,
  dbResult: GranuleWithProviderAndCollectionInfo
): Promise<ApiGranule> => await translatePostgresGranuleToApiGranule({
  knexOrTransaction: knex,
  granulePgRecord: dbResult,
  collectionPgRecord: {
    cumulus_id: dbResult.collection_cumulus_id,
    name: dbResult.collectionName,
    version: dbResult.collectionVersion,
  },
  providerPgRecord: {
    name: dbResult.providerName,
  },
});

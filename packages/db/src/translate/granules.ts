import Knex from 'knex';

import { getRecordCumulusId } from '../database';
import { PdrPgModel } from '../models/pdr';
import { PostgresGranule } from '../types/granule';
import { PostgresExecutionRecord } from '../types/execution';
import { ProviderPgModel } from '../models/provider';
import { tableNames } from '../tables';

/**
 * Generate a Postgres rule record from a DynamoDB record.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Object} knex - Knex client for reading from RDS database
 * @param {number} collectionCumulusId - Collection Cumulus Id
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} pdrPgModel - Instance of the pdr database model
 * @returns {Object} A granule PG record
 */
export const translateApiGranuleToPostgresGranule = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex,
  collectionCumulusId: number,
  providerPgModel = new ProviderPgModel(),
  pdrPgModel = new PdrPgModel()
): Promise<PostgresGranule> => {
  const granuleRecord: PostgresGranule = {
    granule_id: dynamoRecord.granuleId,
    status: dynamoRecord.status,
    collection_cumulus_id: collectionCumulusId,
    published: dynamoRecord.published,
    duration: dynamoRecord.duration,
    time_to_archive: dynamoRecord.timeToArchive,
    time_to_process: dynamoRecord.timeToPreprocess,
    product_volume: dynamoRecord.productVolume,
    error: dynamoRecord.error,
    cmr_link: dynamoRecord.cmrLink,
    execution_cumulus_id: dynamoRecord.execution
      ? await getRecordCumulusId<PostgresExecutionRecord>(
        { arn: dynamoRecord.execution },
        tableNames.executions,
        knex
      )
      : undefined,
    pdr_cumulus_id: dynamoRecord.pdrName
      ? await pdrPgModel.getRecordCumulusId(
        knex,
        { name: dynamoRecord.pdrName }
      )
      : undefined,
    provider_cumulus_id: dynamoRecord.provider ? await providerPgModel.getRecordCumulusId(
      knex,
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

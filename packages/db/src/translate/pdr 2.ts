import { Knex } from 'knex';

import { removeNilProperties } from '@cumulus/common/util';
import { constructCollectionId, deconstructCollectionId } from '@cumulus/message/Collections';
import { getExecutionUrlFromArn } from '@cumulus/message/Executions';
import { ApiPdr } from '@cumulus/types/api/pdrs';

import { CollectionPgModel } from '../models/collection';
import { ExecutionPgModel } from '../models/execution';
import { ProviderPgModel } from '../models/provider';
import { PostgresPdr, PostgresPdrRecord } from '../types/pdr';

/**
 * Generate a Postgres PDR record from a DynamoDB record.
 *
 * @param {Object} record - A PDR record
 * @param {Object} knex - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} executionPgModel - Instance of the execution database model
 * @returns {Object} A PDR record
 */
export const translateApiPdrToPostgresPdr = async (
  record: ApiPdr,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresPdr> => {
  const { name, version } = deconstructCollectionId(record.collectionId);
  const pdrRecord: PostgresPdr = {
    name: record.pdrName,
    status: record.status,
    provider_cumulus_id: await providerPgModel.getRecordCumulusId(
      knex,
      { name: record.provider }
    ),
    collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
      knex,
      { name, version }
    ),
    execution_cumulus_id: record.execution ? await executionPgModel.getRecordCumulusId(
      knex,
      { url: record.execution }
    ) : undefined,
    progress: record.progress,
    address: record.address,
    pan_sent: record.PANSent,
    pan_message: record.PANmessage,
    original_url: record.originalUrl,
    timestamp: record.timestamp ? new Date(record.timestamp) : undefined,
    duration: record.duration,
    stats: record.stats,
    created_at: (record.createdAt ? new Date(record.createdAt) : undefined),
    updated_at: (record.updatedAt ? new Date(record.updatedAt) : undefined),
  };
  return <PostgresPdr>removeNilProperties(pdrRecord);
};

/**
 * Generate a Postgres PDR record from a DynamoDB record.
 *
 * @param {Object} postgresPDR - A Postgres PDR record
 * @param {Object} knex - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} executionPgModel - Instance of the execution database model
 * @returns {Object} A PDR record
 */
export const translatePostgresPdrToApiPdr = async (
  postgresPDR: PostgresPdrRecord,
  knex: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<ApiPdr> => {
  const collection = await collectionPgModel.get(knex, {
    cumulus_id: postgresPDR.collection_cumulus_id,
  });
  const provider = await providerPgModel.get(knex, {
    cumulus_id: postgresPDR.provider_cumulus_id,
  });

  const execution = postgresPDR.execution_cumulus_id ? await executionPgModel.get(knex, {
    cumulus_id: postgresPDR.execution_cumulus_id,
  }) : undefined;

  const apiPdr: ApiPdr = {
    pdrName: postgresPDR.name,
    provider: provider.name,
    collectionId: constructCollectionId(collection.name, collection.version),
    status: postgresPDR.status,
    createdAt: postgresPDR.created_at.getTime(),
    progress: postgresPDR.progress,
    execution: execution ? getExecutionUrlFromArn(execution.arn) : undefined,
    PANSent: postgresPDR.pan_sent,
    PANmessage: postgresPDR.pan_message,
    stats: postgresPDR.stats,
    address: postgresPDR.address,
    originalUrl: postgresPDR.original_url,
    timestamp: (postgresPDR.timestamp ? postgresPDR.timestamp.getTime() : undefined),
    duration: postgresPDR.duration,
    updatedAt: postgresPDR.updated_at.getTime(),
  };

  return <ApiPdr>removeNilProperties(apiPdr);
};

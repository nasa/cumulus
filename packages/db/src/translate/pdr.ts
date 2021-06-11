import Knex from 'knex';

import { deconstructCollectionId } from '@cumulus/message/Collections';
import { ApiPdr } from '@cumulus/types/api/pdrs';

import { CollectionPgModel } from '../models/collection';
import { ExecutionPgModel } from '../models/execution';
import { ProviderPgModel } from '../models/provider';
import { PostgresPdr } from '../types/pdr';

/**
 * Generate a Postgres PDR record from a DynamoDB record.
 *
 * @param {Object} record - A PDR record
 * @param {Object} knex - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @param {Object} executionPgModel - Instance of the execution database model
 * @returns {Object} A rule record
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
  return pdrRecord;
};

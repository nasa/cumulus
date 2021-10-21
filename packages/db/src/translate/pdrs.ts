import { Knex } from 'knex';

import { CollectionPgModel } from '../models/collection';
import { ExecutionPgModel } from '../models/execution';
import { ProviderPgModel } from '../models/provider';
import { PostgresPdr } from '../types/pdr';

const { deconstructCollectionId } = require('@cumulus/message/Collections');

/**
 * Generate a Postgres PDR record from a DynamoDB record.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex | Knex.Transaction} knexOrTransaction
 *   Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel   - Instance of the provider database model
 * @param {Object} executionPgModel  - Instance of the execution database model
 * @returns {PostgresPdr} A PDR PG record
 */
export const translateApiPdrToPostgresPdr = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knexOrTransaction: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresPdr> => {
  const { name, version } = deconstructCollectionId(dynamoRecord.collectionId);
  const pdrRecord: PostgresPdr = {
    name: dynamoRecord.pdrName,
    provider_cumulus_id: await providerPgModel.getRecordCumulusId(
      knexOrTransaction,
      { name: dynamoRecord.provider }
    ),
    collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
      knexOrTransaction,
      { name, version }
    ),
    execution_cumulus_id: dynamoRecord.execution
      ? await executionPgModel.getRecordCumulusId(
        knexOrTransaction,
        { url: dynamoRecord.execution }
      )
      : undefined,
    status: dynamoRecord.status,
    progress: dynamoRecord.progress,
    pan_sent: dynamoRecord.PANSent,
    pan_message: dynamoRecord.PANmessage,
    stats: dynamoRecord.stats,
    address: dynamoRecord.address,
    original_url: dynamoRecord.originalUrl,
    timestamp: dynamoRecord.timestamp ? new Date(dynamoRecord.timestamp) : undefined,
    duration: dynamoRecord.duration,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined,
  };

  return pdrRecord;
};

import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';
import { PostgresExecution } from '../types/execution';
import { ExecutionPgModel } from '../models/execution';

// TODO move to common location
const {
  // getParentExecutionCumulusId,
  getAsyncOperationCumulusId,
  getCollectionCumulusId,
} = require('../../../api/lambdas/sf-event-sqs-to-db-records/utils');

/**
 * Translate execution record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} knex
 *   Knex client
 * @returns {PostgresExecutionRecord} - converted Execution
 */
export const translateApiExecutionToPostgresExecution = async (
  dynamoRecord: ExecutionRecord,
  knex: Knex
): Promise<PostgresExecution> => {
  const Execution = new ExecutionPgModel();
  const logger = new Logger({ sender: '@cumulus/db/translate/executions' });

  // Map old record to new schema.
  const translatedRecord: PostgresExecution = {
    async_operation_cumulus_id: (
      dynamoRecord.asyncOperationId ? await getAsyncOperationCumulusId(
        dynamoRecord.asyncOperationId, knex
      ) : undefined
    ),
    status: dynamoRecord.status,
    tasks: JSON.stringify(dynamoRecord.tasks),
    error: JSON.stringify(dynamoRecord.error),
    arn: dynamoRecord.arn,
    duration: dynamoRecord.duration,
    original_payload: JSON.stringify(dynamoRecord.originalPayload),
    final_payload: JSON.stringify(dynamoRecord.finalPayload),
    workflow_name: dynamoRecord.type,
    url: dynamoRecord.execution,
    cumulus_version: dynamoRecord.cumulusVersion,
  };

  if (dynamoRecord.timestamp) {
    translatedRecord.timestamp = new Date(Number(dynamoRecord.timestamp));
  }

  if (dynamoRecord.collectionId) {
    // TODO is there a helper for this?
    const collectionNameVersionArray = dynamoRecord.collectionId.split('___');
    translatedRecord.collection_cumulus_id = await getCollectionCumulusId(
      { name: collectionNameVersionArray[0], version: collectionNameVersionArray[1] },
      knex
    );
  }

  // If we have a parentArn, try a lookup in Postgres. If there's a match, set the parent_cumulus_id
  if (dynamoRecord.parentArn !== undefined) {
    let parentId;

    try {
      parentId = await Execution.getRecordCumulusId(
        knex,
        { arn: dynamoRecord.parentArn }
      );

      if (parentId !== undefined) {
        translatedRecord.parent_cumulus_id = parentId;
      }
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        logger.info(error);
      }
    }
  }
  if (dynamoRecord.createdAt !== undefined) {
    translatedRecord.created_at = new Date(dynamoRecord.createdAt);
  }
  if (dynamoRecord.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(dynamoRecord.updatedAt);
  }

  return translatedRecord;
};

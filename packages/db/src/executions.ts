import Knex from 'knex';

import { getRecordCumulusId, tableNames } from '@cumulus/db';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import { PostgresExecutionRecord } from './types';

// TODO needs to be recursive
export const getParentCumulusId = async (execution: ExecutionRecord): Promise<number> => {
  // Get execution collectionId from parentArn
  const executionCumulusId = execution
    ? await getRecordCumulusId<PostgresExecutionRecord>(
      { arn: execution.parentArn },
      tableNames.executions,
      Knex
    )
    : undefined;

  return executionCumulusId;
};

/**
 * Translate execution record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @returns {PostgresExecutionRecord} - converted Execution
 */
export const translateApiExecutionToPostgresExecution = (
  dynamoRecord: ExecutionRecord
): PostgresExecutionRecord => {
  // Map old record to new schema.
  const translatedRecord: PostgresExecutionRecord = {
    async_operation_cumulus_id: (dynamoRecord.asyncOperationId ? Number(dynamoRecord.asyncOperationId) : undefined),
    collection_cumulus_id: (dynamoRecord.collectionId ? Number(dynamoRecord.collectionId) : undefined),
    parent_cumulus_id: getParentCumulusId(dynamoRecord),
    status: dynamoRecord.status,
    tasks: JSON.stringify(dynamoRecord.tasks), //TODO check this
    error: JSON.stringify(dynamoRecord.error),
    arn: dynamoRecord.arn,
    duration: dynamoRecord.duration,
    original_payload: JSON.stringify(dynamoRecord.originalPayload), //TODO check this
    final_payload: JSON.stringify(dynamoRecord.finalPayload),
    timestamp: new Date(Number(dynamoRecord.timestamp)), //TODO check this
  };

  if (dynamoRecord.createdAt !== undefined) {
    translatedRecord.created_at = new Date(dynamoRecord.createdAt);
  }
  if (dynamoRecord.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(dynamoRecord.updatedAt);
  }

  return translatedRecord;
};

import Knex from 'knex';

import { RecordDoesNotExist } from '@cumulus/errors';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';
import { PostgresExecution } from '../types/execution';
import { ExecutionPgModel } from '../models/execution';
import { CollectionPgModel } from '../models/collection';
import { AsyncOperationPgModel } from '../models/async_operation';

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
  const executionPgModel = new ExecutionPgModel();
  const collectionPgModel = new CollectionPgModel();
  const asyncOperationPgModel = new AsyncOperationPgModel();
  const logger = new Logger({ sender: '@cumulus/db/translate/executions' });

  // Map old record to new schema.
  const translatedRecord: PostgresExecution = {
    async_operation_cumulus_id: (
      dynamoRecord.asyncOperationId ? await asyncOperationPgModel.getRecordCumulusId(
        knex,
        { id: dynamoRecord.asyncOperationId }
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
    timestamp: dynamoRecord.timestamp ? new Date(dynamoRecord.timestamp) : undefined,
    created_at: dynamoRecord.createdAt ? new Date(dynamoRecord.createdAt) : undefined,
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined,
  };

  if (dynamoRecord.collectionId !== undefined) {
    const collectionNameVersionArray = dynamoRecord.collectionId.split('___');
    translatedRecord.collection_cumulus_id = await collectionPgModel.getRecordCumulusId(
      knex,
      { name: collectionNameVersionArray[0], version: collectionNameVersionArray[1] }
    );
  }

  // If we have a parentArn, try a lookup in Postgres. If there's a match, set the parent_cumulus_id
  if (dynamoRecord.parentArn !== undefined) {
    let parentId;

    try {
      parentId = await executionPgModel.getRecordCumulusId(
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

  return translatedRecord;
};

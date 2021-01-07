import Knex from 'knex';

<<<<<<< HEAD
import { RecordDoesNotExist } from '@cumulus/errors';
import { ExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';
import { PostgresExecution } from '../types/execution';
import { ExecutionPgModel } from '../models/execution';
import { CollectionPgModel } from '../models/collection';
import { AsyncOperationPgModel } from '../models/async_operation';
=======
import { ExecutionRecord } from '@cumulus/types/api/executions';
<<<<<<<< HEAD:packages/db/src/translate/executions.ts
import { PostgresExecution } from '../types';
// TODO move to common location
========
import { PostgresExecution } from './types';
>>>>>>>> e5fc49703... CUMULUS-2188 update type definition location and translation .ts to new locations per new conventions:packages/db/src/executions.ts
const {
  getParentExecutionCumulusId,
} = require('../../api/lambdas/sf-event-sqs-to-db-records/utils');
>>>>>>> e5fc49703... CUMULUS-2188 update type definition location and translation .ts to new locations per new conventions

/**
 * Translate execution record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} knex
 *   Knex client
<<<<<<< HEAD
 * @param {Object} collectionPgModel
 *   Instance of the collection database model
 * @param {Object} asyncOperationPgModel
 *   Instance of the async operation database model
 * @param {Object} executionPgModel
 *   Instance of the execution database model
=======
>>>>>>> e5fc49703... CUMULUS-2188 update type definition location and translation .ts to new locations per new conventions
 * @returns {PostgresExecutionRecord} - converted Execution
 */
export const translateApiExecutionToPostgresExecution = async (
  dynamoRecord: ExecutionRecord,
<<<<<<< HEAD
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresExecution> => {
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
    arn: dynamoRecord.arn,
    duration: dynamoRecord.duration,
    error: dynamoRecord.error,
    tasks: dynamoRecord.tasks,
    original_payload: dynamoRecord.originalPayload,
    final_payload: dynamoRecord.finalPayload,
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
      } else {
        throw error;
      }
    }
  }
=======
  knex: Knex
): Promise<PostgresExecution> => {
  // Map old record to new schema.
  const translatedRecord: PostgresExecution = {
    async_operation_cumulus_id: (
      dynamoRecord.asyncOperationId ? Number(dynamoRecord.asyncOperationId) : undefined
    ),
    collection_cumulus_id: (
      dynamoRecord.collectionId ? Number(dynamoRecord.collectionId) : undefined
    ),
    status: dynamoRecord.status,
    tasks: JSON.stringify(dynamoRecord.tasks),
    error: JSON.stringify(dynamoRecord.error),
    arn: dynamoRecord.arn,
    duration: dynamoRecord.duration,
    original_payload: JSON.stringify(dynamoRecord.originalPayload),
    final_payload: JSON.stringify(dynamoRecord.finalPayload),
    timestamp: new Date(Number(dynamoRecord.timestamp)),
    workflow_name: dynamoRecord.name,
  };

  // If we have a parentArn, try a lookup in Postgres. If there's a match, set the parent_cumulus_id
  if (dynamoRecord.parentArn !== undefined) {
    const parentId = await getParentExecutionCumulusId(dynamoRecord.parentArn, knex);

    if (parentId !== undefined) {
      translatedRecord.parent_cumulus_id = parentId;
    }
  }
  if (dynamoRecord.createdAt !== undefined) {
    translatedRecord.created_at = new Date(dynamoRecord.createdAt);
  }
  if (dynamoRecord.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(dynamoRecord.updatedAt);
  }
>>>>>>> e5fc49703... CUMULUS-2188 update type definition location and translation .ts to new locations per new conventions

  return translatedRecord;
};

import { Knex } from 'knex';

import isNil from 'lodash/isNil';
import isNull from 'lodash/isNull';

import { RecordDoesNotExist } from '@cumulus/errors';
import { ApiExecution, ExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';
import { removeNilProperties } from '@cumulus/common/util';
import { ValidationError } from '@cumulus/errors';
import { constructCollectionId, deconstructCollectionId } from '@cumulus/message/Collections';
import { PostgresExecution, PostgresExecutionRecord } from '../types/execution';
import { ExecutionPgModel } from '../models/execution';
import { CollectionPgModel } from '../models/collection';
import { AsyncOperationPgModel } from '../models/async_operation';

export const translatePostgresExecutionToApiExecution = async (
  executionRecord: PostgresExecutionRecord,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<ExecutionRecord> => {
  let parentArn: string | undefined;
  let collectionId: string | undefined;
  let asyncOperationId: string | undefined;

  if (executionRecord.collection_cumulus_id) {
    const collection = await collectionPgModel.get(knex, {
      cumulus_id: executionRecord.collection_cumulus_id,
    });
    collectionId = constructCollectionId(collection.name, collection.version);
  }
  if (executionRecord.async_operation_cumulus_id) {
    const asyncOperation = await asyncOperationPgModel.get(knex, {
      cumulus_id: executionRecord.async_operation_cumulus_id,
    });
    asyncOperationId = asyncOperation.id;
  }
  if (executionRecord.parent_cumulus_id) {
    const parentExecution = await executionPgModel.get(knex, {
      cumulus_id: executionRecord.parent_cumulus_id,
    });
    parentArn = parentExecution.arn;
  }

  const postfix = executionRecord.arn.split(':').pop();
  if (!postfix) {
    throw new Error(`Execution ARN record ${executionRecord.arn} has an invalid postfix and API cannot generate the required 'name' field`);
  }

  const translatedRecord = {
    name: postfix,
    status: executionRecord.status,
    arn: executionRecord.arn,
    duration: executionRecord.duration,
    error: executionRecord.error,
    tasks: executionRecord.tasks,
    originalPayload: executionRecord.original_payload,
    finalPayload: executionRecord.final_payload,
    type: executionRecord.workflow_name,
    execution: executionRecord.url,
    cumulusVersion: executionRecord.cumulus_version,
    asyncOperationId,
    collectionId,
    parentArn,
    createdAt: executionRecord.created_at.getTime(),
    updatedAt: executionRecord.updated_at.getTime(),
    timestamp: executionRecord.timestamp?.getTime(),
  };
  return <ExecutionRecord>removeNilProperties(translatedRecord);
};

const returnNullOrUndefinedOrDate = (
  dateVal: string | number | null | undefined
) => (isNil(dateVal) ? dateVal : new Date(dateVal));

/**
 * Validate translation api record doesn't contain invalid null/undefined values based
 * on PostgresExecution typings.  Throw if invalid nulls detected
 *
 * @param {ApiExecution} apiExecution
 *   Record from api
 * @returns {undefined}
 */
const validateApiToPostgresExecutionObject = (apiExecution : ApiExecution) => {
  if (isNil(apiExecution.arn)) {
    throw new ValidationError('arn cannot be undefined on a execution, executions must have a arn and a name');
  }
  if (isNil(apiExecution.name)) {
    throw new ValidationError('name cannot be undefined on a execution, executions must have a arn and a name');
  }
  if (isNull(apiExecution.status)) {
    throw new ValidationError('status cannot be null on a execution, executions must have a arn and a name');
  }
};

/**
 * Translate execution record from Dynamo to RDS.
 *
 * @param {ApiExecution} dynamoRecord
 *   Source record from DynamoDB
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} knex
 *   Knex client
 * @param {Object} collectionPgModel
 *   Instance of the collection database model
 * @param {Object} asyncOperationPgModel
 *   Instance of the async operation database model
 * @param {Object} executionPgModel
 *   Instance of the execution database model
 * @returns {PostgresExecutionRecord} - converted Execution
 */
export const translateApiExecutionToPostgresExecutionWithoutNilsRemoved = async (
  dynamoRecord: ApiExecution,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresExecution> => {
  const logger = new Logger({ sender: '@cumulus/db/translate/executions' });

  validateApiToPostgresExecutionObject(dynamoRecord);
  // Map old record to new schema.
  const translatedRecord: PostgresExecution = {
    async_operation_cumulus_id: (
      dynamoRecord.asyncOperationId ? await asyncOperationPgModel.getRecordCumulusId(
        knex,
        { id: dynamoRecord.asyncOperationId }
      ) : (isNull(dynamoRecord.asyncOperationId) ? null : undefined)
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
    timestamp: returnNullOrUndefinedOrDate(dynamoRecord.timestamp),
    created_at: returnNullOrUndefinedOrDate(dynamoRecord.createdAt),
    updated_at: returnNullOrUndefinedOrDate(dynamoRecord.updatedAt),
  };

  if (!isNil(dynamoRecord.collectionId)) {
    const { name, version } = deconstructCollectionId(dynamoRecord.collectionId);
    translatedRecord.collection_cumulus_id = await collectionPgModel.getRecordCumulusId(
      knex,
      { name, version }
    );
  }

  // If we have a parentArn, try a lookup in Postgres. If there's a match, set the parent_cumulus_id
  if (!isNil(dynamoRecord.parentArn)) {
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

  return <PostgresExecution>translatedRecord;
};

export const translateApiExecutionToPostgresExecution = async (
  dynamoRecord: ApiExecution,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresExecution> => removeNilProperties(
  await translateApiExecutionToPostgresExecutionWithoutNilsRemoved(
    dynamoRecord,
    knex,
    collectionPgModel,
    asyncOperationPgModel,
    executionPgModel
  )
);

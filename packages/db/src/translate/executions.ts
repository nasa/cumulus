//@ts-nocheck
import { Knex } from 'knex';

import isNil from 'lodash/isNil';
import isNull from 'lodash/isNull';

import { RecordDoesNotExist } from '@cumulus/errors';
import { ApiExecution, ApiExecutionRecord } from '@cumulus/types/api/executions';
import Logger from '@cumulus/logger';
import { removeNilProperties, returnNullOrUndefinedOrDate } from '@cumulus/common/util';
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
): Promise<ApiExecutionRecord> => {
  let parentArn: string | undefined;
  let collectionId: string | undefined;
  let asyncOperationId: string | undefined;

  if (executionRecord.collection_cumulus_id) {
    let collection;
    try{
      collection = await collectionPgModel.get(knex, {
        cumulus_id: executionRecord.collection_cumulus_id,
      });
    }catch(error){
      console.log("HELLO", error);
    }
    collection = await collectionPgModel.get(knex, {
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
    //collectionId,
    parentArn,
    createdAt: executionRecord.created_at.getTime(),
    updatedAt: executionRecord.updated_at.getTime(),
    timestamp: executionRecord.timestamp?.getTime(),
  };
  return <ApiExecutionRecord>removeNilProperties(translatedRecord);
};

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
 * Translate execution record from API to RDS.
 *
 * @param {ApiExecution} apiRecord
 *   Source record from API
 * @param {Knex} knex
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
  apiRecord: ApiExecution,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresExecution> => {
  const logger = new Logger({ sender: '@cumulus/db/translate/executions' });

  validateApiToPostgresExecutionObject(apiRecord);
  // Map old record to new schema.
  const translatedRecord: PostgresExecution = {
    async_operation_cumulus_id: (
      apiRecord.asyncOperationId ? await asyncOperationPgModel.getRecordCumulusId(
        knex,
        { id: apiRecord.asyncOperationId }
      ) : (isNull(apiRecord.asyncOperationId) ? null : undefined)
    ),
    status: apiRecord.status,
    arn: apiRecord.arn,
    duration: apiRecord.duration,
    error: apiRecord.error,
    tasks: apiRecord.tasks,
    original_payload: apiRecord.originalPayload,
    final_payload: apiRecord.finalPayload,
    workflow_name: apiRecord.type,
    url: apiRecord.execution,
    cumulus_version: apiRecord.cumulusVersion,
    timestamp: returnNullOrUndefinedOrDate(apiRecord.timestamp),
    created_at: returnNullOrUndefinedOrDate(apiRecord.createdAt),
    updated_at: returnNullOrUndefinedOrDate(apiRecord.updatedAt),
  };

  if (!isNil(apiRecord.collectionId)) {
    const { name, version } = deconstructCollectionId(apiRecord.collectionId);
    translatedRecord.collection_cumulus_id = await collectionPgModel.getRecordCumulusId(
      knex,
      { name, version }
    );
  } else if (isNull(apiRecord.collectionId)) {
    translatedRecord.collection_cumulus_id = null;
  }

  // If we have a parentArn, try a lookup in Postgres. If there's a match, set the parent_cumulus_id
  if (!isNil(apiRecord.parentArn)) {
    let parentId;

    try {
      parentId = await executionPgModel.getRecordCumulusId(
        knex,
        { arn: apiRecord.parentArn }
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
  } else if (isNull(apiRecord.parentArn)) {
    translatedRecord.parent_cumulus_id = null;
  }

  return <PostgresExecution>translatedRecord;
};

export const translateApiExecutionToPostgresExecution = async (
  apiRecord: ApiExecution,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
  asyncOperationPgModel = new AsyncOperationPgModel(),
  executionPgModel = new ExecutionPgModel()
): Promise<PostgresExecution> => removeNilProperties(
  await translateApiExecutionToPostgresExecutionWithoutNilsRemoved(
    apiRecord,
    knex,
    collectionPgModel,
    asyncOperationPgModel,
    executionPgModel
  )
);

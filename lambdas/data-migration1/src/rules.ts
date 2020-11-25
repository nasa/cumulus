import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { PostgresRuleRecord } from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import { RecordDoesNotExist } from '@cumulus/errors';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated, ColumnDoesNotExist } from './errors';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/rules' });
const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

interface CumulusRecord {
  cumulus_id: number
}

/**
 *
 * Retrieve cumulus_id from table using name and version.
 *
 * @param {object} whereClause - where clause for query
 * @param {'providers' | 'collections'} table - Name of table
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordDoesNotExist} if record cannot be found
*/
export const getCumulusId = async (
  whereClause : object,
  table: 'providers' | 'collections',
  knex: Knex
): Promise<number | void> => {
  const result = await knex.schema.hasColumn(table, 'cumulus_id').then(async (exists) => {
    if (exists) {
      const record = await knex.select('cumulus_id')
        .from<CumulusRecord>(table)
        .where(whereClause)
        .first();
      if (record === undefined) {
        throw new RecordDoesNotExist(`Record in ${table} with identifiers ${whereClause} does not exist.`);
      }
      return record.cumulus_id;
    }
    return undefined;
  }).catch((error) => {
    logger.error(error);
  });
  if (result === undefined) {
    throw new ColumnDoesNotExist(`cumulus_id does not exist in table ${table}`);
  }
  return result;
};

/**
 * Migrate rules record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateRuleRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  // Validate record before processing using API model schema
  Manager.recordIsValid(dynamoRecord, schemas.rule);

  const existingRecord = await knex<PostgresRuleRecord>('rules')
    .where({ name: dynamoRecord.name })
    .first();

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Rule name ${dynamoRecord.name} was already migrated, skipping`);
  }

  const collectionCumulusId = dynamoRecord.collection ? await getCumulusId(
    { name: dynamoRecord.collection.name, version: dynamoRecord.collection.version },
    'collections',
    knex
  ) : undefined;
  const providerCumulusId = dynamoRecord.provider ? await getCumulusId({ name: dynamoRecord.provider }, 'providers', knex) : undefined;

  // Map old record to new schema.
  const updatedRecord: PostgresRuleRecord = {
    name: dynamoRecord.name,
    workflow: dynamoRecord.workflow,
    provider_cumulus_id: (providerCumulusId === undefined) ? undefined : providerCumulusId,
    collection_cumulus_id: (collectionCumulusId === undefined) ? undefined : collectionCumulusId,
    enabled: dynamoRecord.state === 'ENABLED',
    type: dynamoRecord.rule.type,
    value: dynamoRecord.rule.value,
    arn: dynamoRecord.rule.arn,
    log_event_arn: dynamoRecord.rule.logEventArn,
    execution_name_prefix: dynamoRecord.executionNamePrefix,
    payload: dynamoRecord.payload,
    meta: dynamoRecord.meta,
    tags: dynamoRecord.tags ? JSON.stringify(dynamoRecord.tags) : undefined,
    queue_url: dynamoRecord.queueUrl,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };

  await knex('rules').insert(updatedRecord);
};

export const migrateRules = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const rulesTable = envUtils.getRequiredEnvVar('RulesTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: rulesTable,
  });

  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationSummary.dynamoRecords += 1;

    try {
      await migrateRuleRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create rule record in RDS for Dynamo Rule name: ${record.name}, version: ${record.version}}`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationSummary.success} rule records.`);
  return migrationSummary;
};

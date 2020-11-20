import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { CollectionRecord, RuleRecord } from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordDoesNotExist } from '@cumulus/errors';
import { RecordAlreadyMigrated } from './errors';
import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/rules' });
const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

/**
 *
 * Retrieve cumulusId from Provider using id.
 *
 * @param {string} name - Provider ID
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordDoesNotExist} if record cannot be found
 */
const getProviderCumulusId = async (
  name: string,
  knex: Knex
): Promise<any> => {
  const record = await knex.queryBuilder()
    .select()
    .table('providers')
    .where({ name: name })
    .first();

  if (record === undefined) {
    throw new RecordDoesNotExist(`Provider with id ${name} does not exist.`);
  }
  return record;
};

/**
 *
 * Retrieve cumulusId from Collection using name and version.
 *
 * @param {string} name - Collection Name
 * @param {string} version - Collection version
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordDoesNotExist} if record cannot be found
 */
const getCollectionCumulusId = async (
  name : string,
  version: string,
  knex: Knex
): Promise<number> => {
  const record = await knex.select(knex.ref('cumulusId').as('collectionCumulusId'))
    .from<CollectionRecord>('collections')
    .where({ name: name, version: version })
    .first();

  if (record === undefined) {
    throw new RecordDoesNotExist(`Collection with name ${name} and version ${version} does not exist.`);
  }
  return record.collectionCumulusId;
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

  const existingRecord = await knex<RuleRecord>('rules')
    .where({ name: dynamoRecord.name })
    .first();

  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Rule name ${dynamoRecord.name} was already migrated, skipping`);
  }

  const collectionCumulusId = await getCollectionCumulusId(dynamoRecord.collection.name, dynamoRecord.collection.version, knex);
  const providerCumulusId = await getProviderCumulusId(dynamoRecord.provider, knex);

  // Map old record to new schema.
  const updatedRecord: RuleRecord = {
    name: dynamoRecord.name,
    workflow: dynamoRecord.workflow,
    collectionCumulusId: collectionCumulusId,
    providerCumulusId: providerCumulusId.cumulusId,
    enabled: dynamoRecord.state === 'ENABLED',
    type: dynamoRecord.rule.type,
    value: dynamoRecord.rule.value,
    arn: dynamoRecord.rule.arn,
    logEventArn: dynamoRecord.rule.logEventArn,
    executionNamePrefix: dynamoRecord.executionNamePrefix ? dynamoRecord.executionNamePrefix : undefined,
    payload: dynamoRecord.payload,
    meta: dynamoRecord.meta ? dynamoRecord.meta : undefined,
    tags: dynamoRecord.tags ? dynamoRecord.tags : undefined,
    queueUrl: dynamoRecord.queueUrl,
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
          `Could not create rule record in RDS for Dynamo Rule name ${record.id}:`,
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

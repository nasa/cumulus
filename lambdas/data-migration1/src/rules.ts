import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import {
  RulePgModel,
  translateApiRuleToPostgresRule,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import { RuleRecord } from '@cumulus/types/api/rules';

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/rules' });

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
  const rulePgModel = new RulePgModel();

  let existingRecord;

  try {
    existingRecord = await rulePgModel.get(knex, {
      name: dynamoRecord.name,
    });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  // Throw error if it was already migrated.
  if (existingRecord && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt)) {
    throw new RecordAlreadyMigrated(`Rule name ${dynamoRecord.name} was already migrated, skipping`);
  }

  // Map old record to new schema.
  const updatedRecord = await translateApiRuleToPostgresRule(<RuleRecord>dynamoRecord, knex);

  await rulePgModel.upsert(knex, updatedRecord);
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
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create rule record in RDS for Dynamo Rule name: ${record.name}`,
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

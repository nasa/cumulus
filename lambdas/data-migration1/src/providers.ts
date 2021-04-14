import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import * as KMS from '@cumulus/aws-client/KMS';
import { envUtils, keyPairProvider } from '@cumulus/common';
import {
  ProviderPgModel,
  translateApiProviderToPostgresProvider,
} from '@cumulus/db';
import Logger from '@cumulus/logger';
import { RecordAlreadyMigrated, RecordDoesNotExist } from '@cumulus/errors';
import { ApiProvider } from '@cumulus/types/api/providers';

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/providers' });

const decrypt = async (value: string): Promise<string> => {
  try {
    const plaintext = await KMS.decryptBase64String(value);

    if (plaintext === undefined) {
      throw new Error('Unable to decrypt');
    }

    return plaintext;
  } catch (error) {
    return keyPairProvider.S3KeyPairProvider.decrypt(value);
  }
};

/**
 * Migrate provider record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated}
 *   if record was already migrated
 */
export const migrateProviderRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const providerPgModel = new ProviderPgModel();

  let existingRecord;

  try {
    existingRecord = await providerPgModel.get(knex, {
      name: dynamoRecord.id,
    });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }
  // Throw error if it was already migrated.
  if (existingRecord && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt)) {
    throw new RecordAlreadyMigrated(`Provider name ${dynamoRecord.id} was already migrated, skipping`);
  }

  let { username, password } = dynamoRecord;
  const { encrypted } = dynamoRecord;

  if (username) {
    username = encrypted ? await decrypt(username) : username;
  }

  if (password) {
    password = encrypted ? await decrypt(password) : password;
  }

  // Map old record to new schema.
  const updatedRecord = await translateApiProviderToPostgresProvider(
    <ApiProvider>{
      ...dynamoRecord,
      username,
      password,
    }
  );

  await providerPgModel.upsert(knex, updatedRecord);
};

export const migrateProviders = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const providersTable = envUtils.getRequiredEnvVar('ProvidersTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: providersTable,
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
      await migrateProviderRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create provider record in RDS for Dynamo provider name ${record.id}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} provider records`);
  return migrationSummary;
};

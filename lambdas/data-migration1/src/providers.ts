import Knex from 'knex';
import isNil from 'lodash/isNil';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import * as KMS from '@cumulus/aws-client/KMS';
import { envUtils, keyPairProvider } from '@cumulus/common';
import Logger from '@cumulus/logger';

import { RecordAlreadyMigrated } from './errors';
import { MigrationSummary } from './types';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

const logger = new Logger({ sender: '@cumulus/data-migration/providers' });

export interface RDSProviderRecord {
  name: string
  protocol: string
  host: string
  port?: number
  username?: string
  password?: string
  encrypted?: boolean
  globalConnectionLimit?: number
  privateKey?: string
  cmKeyId?: string
  certificateUri?: string
  created_at: Date
  updated_at?: Date
}

const encryptProviderCredential = async (
  value: string,
  encrypted?: boolean
) => {
  if (isNil(value)) return undefined;

  const providerKmsKeyId = envUtils.getRequiredEnvVar('provider_kms_key_id');

  if (encrypted) {
    return keyPairProvider.S3KeyPairProvider
      .decrypt(value)
      .then(
        (decryptedValue) => KMS.encrypt(providerKmsKeyId, decryptedValue),
        async (error) => {
          // If we already have a KMS encrypted value, return it.
          if ((await KMS.decryptBase64String(value))) {
            return value;
          }
          throw error;
        }
      );
  }

  return KMS.encrypt(providerKmsKeyId, value);
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
): Promise<number> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.provider);

  const [existingRecord] = await knex('providers')
    .where('name', dynamoRecord.id);
  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Provider name ${dynamoRecord.id} was already migrated, skipping`);
  }

  let { username, password, encrypted } = dynamoRecord;
  if (username || password) {
    username = await encryptProviderCredential(username, encrypted);
    password = await encryptProviderCredential(password, encrypted);
    encrypted = true;
  }

  // Map old record to new schema.
  const updatedRecord: RDSProviderRecord = {
    name: dynamoRecord.id,
    protocol: dynamoRecord.protocol,
    host: dynamoRecord.host,
    port: dynamoRecord.port,
    username,
    password,
    encrypted,
    globalConnectionLimit: dynamoRecord.globalConnectionLimit,
    privateKey: dynamoRecord.privateKey,
    cmKeyId: dynamoRecord.cmKeyId,
    certificateUri: dynamoRecord.certificateUri,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined,
  };

  const [cumulusId] = await knex('providers')
    .returning('cumulusId')
    .insert(updatedRecord);
  return cumulusId;
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

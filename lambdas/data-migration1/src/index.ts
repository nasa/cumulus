import AWS from 'aws-sdk';
import Knex from 'knex';
import isNil from 'lodash/isNil';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import * as KMS from '@cumulus/aws-client/KMS';
import { getKnexClient } from '@cumulus/db';
import { envUtils, keyPairProvider } from '@cumulus/common';
import { createErrorType } from '@cumulus/errors';
import Logger from '@cumulus/logger';

const Manager = require('@cumulus/api/models/base');
const schemas = require('@cumulus/api/models/schemas');

const logger = new Logger({ sender: '@cumulus/data-migration' });

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export interface RDSCollectionRecord {
  name: string
  version: string
  process: string
  granuleIdValidationRegex: string
  granuleIdExtractionRegex: string
  files: string
  // default will be set by schema validation
  duplicateHandling: string
  // default will be set by schema validation
  reportToEms: boolean
  sampleFileName?: string
  url_path?: string
  ignoreFilesConfigForDiscovery?: boolean
  meta?: object
  tags?: string
  created_at: Date
  updated_at: Date
}

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

interface MigrationSummary {
  dynamoRecords: number
  success: number
  skipped: number
  failed: number
}

export const RecordAlreadyMigrated = createErrorType('RecordAlreadyMigrated');

/**
 * Migrate collection record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Source record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated}
 *   if record was already migrated
 */
export const migrateCollectionRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<number> => {
  // Use API model schema to validate record before processing
  Manager.recordIsValid(dynamoRecord, schemas.collection);

  const [existingRecord] = await knex('collections')
    .where('name', dynamoRecord.name)
    .where('version', dynamoRecord.version);
  // Throw error if it was already migrated.
  if (existingRecord) {
    throw new RecordAlreadyMigrated(`Collection name ${dynamoRecord.name}, version ${dynamoRecord.version} was already migrated, skipping`);
  }

  // Map old record to new schema.
  const updatedRecord: RDSCollectionRecord = {
    name: dynamoRecord.name,
    version: dynamoRecord.version,
    process: dynamoRecord.process,
    url_path: dynamoRecord.url_path,
    duplicateHandling: dynamoRecord.duplicateHandling,
    granuleIdValidationRegex: dynamoRecord.granuleId,
    granuleIdExtractionRegex: dynamoRecord.granuleIdExtraction,
    // have to stringify on an array of values
    files: JSON.stringify(dynamoRecord.files),
    reportToEms: dynamoRecord.reportToEms,
    sampleFileName: dynamoRecord.sampleFileName,
    ignoreFilesConfigForDiscovery: dynamoRecord.ignoreFilesConfigForDiscovery,
    meta: dynamoRecord.meta ? dynamoRecord.meta : undefined,
    // have to stringify on an array of values
    tags: dynamoRecord.tags ? JSON.stringify(dynamoRecord.tags) : undefined,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: new Date(dynamoRecord.updatedAt),
  };

  const [cumulusId] = await knex('collections')
    .returning('cumulusId')
    .insert(updatedRecord);
  return cumulusId;
};

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
        // If S3 keypair decryption failed, then assume we already have a KMS encrypted value
        () => value
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
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined
  };

  const [cumulusId] = await knex('providers')
    .returning('cumulusId')
    .insert(updatedRecord);
  return cumulusId;
};

export const migrateCollections = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const collectionsTable = envUtils.getRequiredEnvVar('CollectionsTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: collectionsTable,
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
      await migrateCollectionRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
        logger.info(error);
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create collection record in RDS for Dynamo collection name ${record.name}, version ${record.version}:`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`successfully migrated ${migrationSummary.success} collection records`);
  return migrationSummary;
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

export const handler = async (event: HandlerEvent): Promise<string> => {
  const env = event.env ?? process.env;

  const knex = await getKnexClient({ env });

  try {
    const collectionsMigrationSummary = await migrateCollections(env, knex);
    const providersMigrationSummary = await migrateProviders(env, knex);
    return `
      Migration summary:
        Collections:
          Out of ${collectionsMigrationSummary.dynamoRecords} Dynamo records:
            ${collectionsMigrationSummary.success} records migrated
            ${collectionsMigrationSummary.skipped} records skipped
            ${collectionsMigrationSummary.failed} records failed
        Providers:
          Out of ${providersMigrationSummary.dynamoRecords} Dynamo records:
            ${providersMigrationSummary.success} records migrated
            ${providersMigrationSummary.skipped} records skipped
            ${providersMigrationSummary.failed} records failed
    `;
  } finally {
    await knex.destroy();
  }
};

import Knex from 'knex';
import { RuleRecord } from '@cumulus/types/api/rules';
import { PostgresRule, PostgresCollectionRecord, PostgresProviderRecord} from './types';
import { getRecordCumulusId } from './database';
import { tableNames } from './tables';

const getCollectionCumulusId = async (record: RuleRecord, dbClient: Knex) => {
  if (record.collection) {
    await getRecordCumulusId<PostgresCollectionRecord>(
      { name: record.collection.name, version: record.collection.version },
      tableNames.collections,
      dbClient
    );
  }
  return undefined;
};

const getProviderCumulusId = async (record: RuleRecord, dbClient: Knex) => {
  if (record.provider) {
    const result = await getRecordCumulusId<PostgresProviderRecord>(
      { name: record.provider },
      tableNames.providers,
      dbClient
    );
    return result;
  }
  return undefined;
};

/**
 * Generate a Postgres rule record from a DynamoDB record.
 * @param {Object} record - A rule
 * @param {Object} dbClient - Knex client for reading from RDS database
 * @returns {Object} A rule record
 */
export const translateApiRuleToPostgresRule = async (
  record: RuleRecord,
  dbClient: Knex
): Promise<PostgresRule> => {
  const collectionCumulusId = await getCollectionCumulusId(record, dbClient);
  const providerCumulusId = await getProviderCumulusId(record, dbClient);
  const ruleRecord: PostgresRule = {
    name: record.name,
    workflow: record.workflow,
    provider_cumulus_id: record.provider ? providerCumulusId : undefined,
    collection_cumulus_id: record.collection ? collectionCumulusId : undefined,
    meta: (record.meta ? JSON.stringify(record.meta) : undefined),
    payload: record.payload as any,
    queue_url: record.queueName,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    enabled: record.state ? record.state === 'ENABLED' : true,
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };

  return ruleRecord;
};

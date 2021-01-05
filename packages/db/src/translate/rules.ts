import Knex from 'knex';
import { RuleRecord } from '@cumulus/types/api/rules';
import { PostgresCollectionRecord } from '../types/collection';
import { PostgresProviderRecord } from '../types/provider';
import { PostgresRule } from '../types/rule';
import { getRecordCumulusId } from '../database';
import { tableNames } from '../tables';

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
  const ruleRecord: PostgresRule = {
    name: record.name,
    workflow: record.workflow,
    provider_cumulus_id: record.provider ? await getRecordCumulusId<PostgresProviderRecord>(
      { name: record.provider },
      tableNames.providers,
      dbClient
    ) : undefined,
    collection_cumulus_id: record.collection ? await getRecordCumulusId<PostgresCollectionRecord>(
      { name: record.collection.name, version: record.collection.version },
      tableNames.collections,
      dbClient
    ) : undefined,
    meta: record.meta,
    payload: record.payload as any,
    queue_url: record.queueUrl,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    log_event_arn: record.rule.logEventArn,
    enabled: (record.state === undefined) || (record.state === 'ENABLED'),
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };

  return ruleRecord;
};

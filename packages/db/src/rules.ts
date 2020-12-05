import { RuleRecord } from '@cumulus/types/api/rules';
import { PostgresRule } from './types';

/**
 * Generate a Postgres rule record from a DynamoDB record.
 * @param {Object} record - A rule
 * @returns {Object} A rule record
 */
export const translateApiRuleToPostgresRule = (
  record: RuleRecord
): PostgresRule => {
  const ruleRecord: PostgresRule = {
    name: record.name,
    workflow: record.workflow,
    meta: (record.meta ? JSON.stringify(record.meta) : undefined),
    payload: record.payload as any,
    queue_url: record.queueName,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    enabled: record.state === 'ENABLED',
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };

  return ruleRecord;
};

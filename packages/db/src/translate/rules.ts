import Knex from 'knex';
import { RuleRecord, RuleType } from '@cumulus/types/api/rules';
import { removeNilProperties } from '@cumulus/common/util';

import { CollectionPgModel } from '../models/collection';
import { ProviderPgModel } from '../models/provider';
import { PostgresRule, PostgresRuleRecord } from '../types/rule';

/**
 * Generate a Postgres rule record from a DynamoDB record.
 *
 * @param {Object} record - A rule
 * @param {Object} dbClient - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @returns {Object} A rule record
 */
export const translateApiRuleToPostgresRule = async (
  record: RuleRecord,
  dbClient: Knex,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<PostgresRule> => {
  const ruleRecord: PostgresRule = {
    name: record.name,
    workflow: record.workflow,
    provider_cumulus_id: record.provider ? await providerPgModel.getRecordCumulusId(
      dbClient,
      { name: record.provider }
    ) : undefined,
    collection_cumulus_id: record.collection ? await collectionPgModel.getRecordCumulusId(
      dbClient,
      { name: record.collection.name, version: record.collection.version }
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
    created_at: (record.createdAt ? new Date(record.createdAt) : undefined),
    updated_at: (record.updatedAt ? new Date(record.updatedAt) : undefined),
  };

  return removeNilProperties(ruleRecord);
};

export const translatePostgresRuleToApiRule = async (
  record: PostgresRuleRecord,
  dbClient: Knex,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<RuleRecord> => {
  let collection: undefined | { name: string, version: string };
  if (record.collection_cumulus_id) {
    const { name, version } = await collectionPgModel.get(dbClient, {
      cumulus_id: record.provider_cumulus_id,
    });
    collection = { name, version };
  }
  return removeNilProperties({
    name: record.name,
    workflow: record.workflow,
    provider: record.provider_cumulus_id ?
      (await providerPgModel.get(dbClient, { cumulus_id: record.provider_cumulus_id })).name
      : undefined,
    collection,
    meta: record?.meta as { retries?: number, visilibity?: number, [key: string]: unknown},
    payload: record.payload as any,
    queueUrl: record.queue_url,
    rule: removeNilProperties({
      arn: record.arn,
      type: record.type as RuleType,
      value: record.value,
      logEventArn: record.log_event_arn,
    }),
    state: record.enabled ? 'ENABLED' : 'DISABLED',
    tags: record.tags ? JSON.parse(record.tags) : undefined,
    executionNamePrefix: record.execution_name_prefix,
    createdAt: record.created_at.getTime(),
    updatedAt: record.updated_at.getTime(),
  });
};

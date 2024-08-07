import { Knex } from 'knex';
import { removeNilProperties } from '@cumulus/common/util';
import { RuleRecord, Rule } from '@cumulus/types/api/rules';

import { CollectionPgModel } from '../models/collection';
import { ProviderPgModel } from '../models/provider';
import { PostgresRule } from '../types/rule';

export const translatePostgresRuleToApiRule = async (
  pgRule: any, // TODO: create type for pgRule with collection and provider
  knex: Knex | Knex.Transaction,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel(),
): Promise<RuleRecord> => {
  let collection;
  let pgProvider;

  if (!pgRule.provider && pgRule.provider_cumulus_id) {
    pgProvider = await providerPgModel.get(knex, { cumulus_id: pgRule.provider_cumulus_id });
  }

  if (pgRule.collectionName && pgRule.collectionVersion) {
    collection = {
      name: pgRule.collectionName,
      version: pgRule.collectionVersion,
    }
  } else {
    if (pgRule.collection_cumulus_id) {
      const pgCollection = await collectionPgModel.get(knex, { cumulus_id: pgRule.collection_cumulus_id });
      collection = {
        name: pgCollection.name,
        version: pgCollection.version,
      }
    }
  }

  const apiRule: RuleRecord = {
    name: pgRule.name,
    workflow: pgRule.workflow,
    provider: pgRule.provider || pgProvider?.name,
    collection,
    rule: <Rule>removeNilProperties({
      type: pgRule.type,
      arn: pgRule.arn,
      logEventArn: pgRule.log_event_arn,
      value: pgRule.value,
    }),
    state: pgRule.enabled ? 'ENABLED' : 'DISABLED',
    meta: pgRule.meta,
    payload: pgRule.payload,
    executionNamePrefix: pgRule.execution_name_prefix,
    queueUrl: pgRule.queue_url,
    tags: pgRule.tags,
    createdAt: pgRule.created_at.getTime(),
    updatedAt: pgRule.updated_at.getTime(),
  };
  return <RuleRecord>removeNilProperties(apiRule);
};

/**
 * Generate a Postgres rule record from a DynamoDB record.
 *
 * @param {Object} record - A rule
 * @param {Object} dbClient - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @returns {Object} A rule record
 */
export const translateApiRuleToPostgresRuleRaw = async (
  record: RuleRecord,
  dbClient: Knex,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<PostgresRule> => ({
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
});

/**
 * Generate a Postgres rule record from a DynamoDB record and remove nil properties.
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
  const ruleRecord: PostgresRule = await translateApiRuleToPostgresRuleRaw(
    record,
    dbClient,
    collectionPgModel,
    providerPgModel
  );
  return <PostgresRule>removeNilProperties(ruleRecord);
};

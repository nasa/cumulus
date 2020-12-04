'use strict';

const AggregateError = require('aggregate-error');

const log = require('@cumulus/common/log');
const {
  tableNames,
} = require('@cumulus/db');
const {
  getMessageRules,
} = require('@cumulus/message/Rules');

const Rule = require('../../models/rules');

const buildRuleRecord = (
  rule,
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  now = new Date()
) => {
  const name = rule.name;
  return {
    name,
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
    workflow: rule.workflow,
    enabled: rule.state === 'ENABLED',
    type: rule.rule.type,
    value: rule.rule.value,
    arn: rule.rule.arn,
    log_event_arn: rule.rule.log_event_arn,
    payload: rule.payload,
    meta: rule.meta,
    tags: rule.tags ? JSON.stringify(rule.tags) : undefined,
    queue_url: rule.queue_rule,
    created_at: rule.created_at,
    updated_at: now,
  };
};

const writeRuleViaTransaction = async ({
  rule,
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  trx,
}) => {
  const record = buildRuleRecord(rule, cumulusMessage, collectionCumulusId, providerCumulusId);
  return trx(tableNames.rules)
    .insert(record)
    .returning('cumulus_id');
};

/**
 * Write a rule to DynamoDB and Postgres
 *
 * @param {Object} params
 * @param {Object} params.rule - An API Rule object
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {string} params.providerCumulusId
 *   Cumulus ID for provider referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with Postgres database
 * @param {Object} [params.ruleModel]
 *   Optional override for the rule model writing to DynamoDB
 *
 * @returns {Promise}
 * @throws
 */
const writeRule = async ({
  rule,
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  knex,
  ruleModel,
}) =>
  knex.transaction(async (trx) => {
    await writeRuleViaTransaction({
      rule,
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      trx,
    });
    return ruleModel.storeRuleFromCumulusMessage({ rule });
  });

/**
 * Write rules to DynamoDB and Postgres
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.collectionCumulusId
 *   Cumulus ID for collection referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with Postgres database
 * @param {string} [params.providerCumulusId]
 *   Cumulus ID for provider referenced in workflow message, if any
 * @param {Object} [params.ruleModel]
 *   Optional override for the rule model writing to DynamoDB
 *
 * @returns {Promise<Object[]>}
 *  true if there are no rules on the message, otherwise
 *  results from Promise.allSettled for all rules
 */
const writeRules = async ({
  cumulusMessage,
  collectionCumulusId,
  providerCumulusId,
  knex,
  ruleModel = new Rule(),
}) => {
  const rules = getMessageRules(cumulusMessage);

  // Process each rule in a separate transaction via Promise.allSettled
  // so that they can succeed/fail independently
  const results = await Promise.allSettled(rules.map(
    (rule) => writeRule({
      rule,
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
      ruleModel,
    })
  ));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some rules to Dynamo', aggregateError);
    throw aggregateError;
  }
  return results;
};

module.exports = {
  writeRuleViaTransaction,
  writeRules,
};

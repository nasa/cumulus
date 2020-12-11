const test = require('ava');
const omit = require('lodash/omit');
const { translateApiRuleToPostgresRule } = require('../dist/rules');

test('translateApiRuleToPostgresRule converts API rule to Postgres', async (t) => {
  const record = {
    name: 'name',
    workflow: 'workflow_name',
    provider: undefined,
    state: 'ENABLED',
    collection: undefined,
    rule: { type: 'onetime', value: 'value', arn: 'arn', logEventArn: 'event_arn' },
    executionNamePrefix: 'prefix',
    meta: { key: 'value' },
    queueName: 'queue_url',
    payload: { result: { key: 'value' } },
    tags: ['tag1', 'tag2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const expectedPostgresRule = {
    name: record.name,
    workflow: record.workflow,
    meta: JSON.stringify(record.meta)
    payload: record.payload,
    queue_url: record.queueUrl,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    log_event_arn: record.rule.logEventArn,
    enabled: true,
    tags: JSON.stringify(record.tags),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };

  const result = await translateApiRuleToPostgresRule(record);
  t.deepEqual(
    omit(result, ['collection_cumulus_id', 'provider_cumulus_id']),
    expectedPostgresRule
  );
});

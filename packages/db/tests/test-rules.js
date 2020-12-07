const test = require('ava');
const { translateApiRuleToPostgresRule } = require('../dist/rules');

test('translateApiRuleToPostgresRule converts API rule to Postgres', (t) => {
  const record = {
    name: 'name',
    workflow: 'workflow_name',
    provider: 'provider_id',
    state: 'ENABLED',
    collection: {
      name: 'collection_name',
      version: 'collection_version',
    },
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
    meta: (record.meta ? JSON.stringify(record.meta) : undefined),
    payload: record.payload,
    queue_url: record.queueName,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    enabled: true,
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };

  t.deepEqual(
    translateApiRuleToPostgresRule(record),
    expectedPostgresRule
  );
});

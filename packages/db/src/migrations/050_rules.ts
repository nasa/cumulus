import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('rules', (table) => {
    table.increments('cumulus_id').primary();

    table.text('name').notNullable();
    table.text('workflow').notNullable();

    table.integer('collection_cumulus_id')
      .references('cumulus_id')
      .inTable('collections');

    table.integer('provider_cumulus_id')
      .references('cumulus_id')
      .inTable('providers');

    table.text('type').notNullable();
    table.boolean('enabled').notNullable();

    table.text('value');
    table.text('arn');
    table.text('log_event_arn');

    table.text('execution_name_prefix');

    table.jsonb('payload');
    table.jsonb('meta');
    table.jsonb('tags');

    table.text('queue_url');

    table.timestamps(false, true);

    table.unique(['name']);

    table.index(['updated_at'], 'rules_updated_at_index');
  });

  await knex.raw(`
    ALTER TABLE rules
    ADD CONSTRAINT rules_type_check
    CHECK (type = ANY (ARRAY[
      'onetime',
      'scheduled',
      'sns',
      'kinesis',
      'sqs'
    ]));
  `);

  await knex.raw(`
    COMMENT ON COLUMN rules.name IS 'Rule name';
    COMMENT ON COLUMN rules.workflow IS 'Workflow name to invoke for this rule';
    COMMENT ON COLUMN rules.type IS 'Specifies how workflows are invoked for this rule';
    COMMENT ON COLUMN rules.enabled IS 'Whether rule is active or not';
    COMMENT ON COLUMN rules.value IS '
      Value is multi-use. For a kinesis rule this is the target stream arn,
      for a scheduled event it is the schedule pattern (e.g. cron), for a one-time rule.
    ';
    COMMENT ON COLUMN rules.arn IS 'For kinesis rules: ARN of event source mapping between Kinesis stream and message consumer Lambda';
    COMMENT ON COLUMN rules.log_event_arn IS 'For kinesis rules: ARN of event source mapping between Kinesis stream and inbound event logger Lambda';
    COMMENT ON COLUMN rules.execution_name_prefix IS 'Optional Execution name prefix';
    COMMENT ON COLUMN rules.payload IS 'Optional input payload to use for onetime and scheduled workflows';
    COMMENT ON COLUMN rules.meta IS 'Optional metadata for the rule. Contents will be automatically added to $.meta on invoked workflows.';
    COMMENT ON COLUMN rules.tags IS 'Optional tags for the rule';
    COMMENT ON COLUMN rules.queue_url IS 'Optional SQS queue URL used to schedule executions for this rule';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('rules');
};

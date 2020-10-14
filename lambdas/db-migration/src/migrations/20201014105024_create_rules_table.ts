import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('rules', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .text('name')
      .comment('Rule name')
      .notNullable();
    table
      .text('workflow')
      .comment('Workflow name to invoke for this rule')
      .notNullable();
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections')
      .notNullable();
    table
      .integer('providerCumulusId')
      .references('cumulusId')
      .inTable('providers')
      .notNullable();
    table
      .enum('type', ['onetime', 'scheduled', 'sns', 'kinesis', 'sqs'])
      .comment(
        'Specifies how workflows are invoked for this rule'
      )
      .notNullable();
    table
      .boolean('enabled')
      .comment('Whether rule is active or not')
      .notNullable();
    table
      .text('value')
      .comment(`
        Value is multi-use. For a kinesis rule this is the target stream arn, for
        a scheduled event it's the schedule pattern (e.g. cron), for a one-time rule.
      `);
    table
      .text('arn')
      .comment('For kinesis rules: ARN of event source mapping between Kinesis stream and message consumer Lambda');
    table
      .text('logEventArn')
      .comment('For kinesis rules: ARN of event source mapping between Kinesis stream and inbound event logger Lambda');
    table
      .jsonb('payload')
      .comment('Optional input payload to use for onetime and scheduled workflows');
    table
      .jsonb('meta')
      .comment('Optional metadata for the rule. Contents will be automatically added to $.meta on invoked workflows.');
    table
      .jsonb('tags')
      .comment('Optional tags for the rule');
    table
      .text('queueUrl')
      .comment('Optional SQS queue URL used to schedule executions for this rule');
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('rules');

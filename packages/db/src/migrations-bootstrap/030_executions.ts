import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('executions', (table) => {
    // Primary key (bigint + sequence)
    table.bigIncrements('cumulus_id').primary();

    // Columns
    table.text('arn').notNullable();

    table.integer('async_operation_cumulus_id');
    table.integer('collection_cumulus_id');
    table.bigInteger('parent_cumulus_id');

    table.text('cumulus_version');
    table.text('url');

    table.text('status').notNullable();

    table.jsonb('tasks');
    table.jsonb('error');

    table.text('workflow_name');
    table.float('duration');

    table.jsonb('original_payload');
    table.jsonb('final_payload');

    table.timestamp('timestamp', { useTz: true });

    table.timestamps(false, true);

    table.boolean('archived').notNullable().defaultTo(false);

    // Indexes
    table.index(['archived'], 'executions_archived_index');
    table.index(['collection_cumulus_id'], 'executions_collection_cumulus_id_index');
    table.index(['parent_cumulus_id'], 'executions_parent_cumulus_id_index');
    table.index(
      ['status', 'collection_cumulus_id', 'cumulus_id'],
      'executions_status_collection_cumulus_id_index'
    );
    table.index(['updated_at'], 'executions_updated_at_index');
  });

  // Unique constraints
  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_arn_unique UNIQUE (arn);
  `);

  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_url_unique UNIQUE (url);
  `);

  // CHECK constraint
  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_status_check
    CHECK (status = ANY (ARRAY[
      'running',
      'completed',
      'failed',
      'unknown'
    ]));
  `);

  // Foreign keys
  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_async_operation_cumulus_id_foreign
    FOREIGN KEY (async_operation_cumulus_id)
    REFERENCES async_operations(cumulus_id);
  `);

  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_collection_cumulus_id_foreign
    FOREIGN KEY (collection_cumulus_id)
    REFERENCES collections(cumulus_id);
  `);

  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_parent_cumulus_id_foreign
    FOREIGN KEY (parent_cumulus_id)
    REFERENCES executions(cumulus_id)
    ON DELETE SET NULL;
  `);

  // Comments
  await knex.raw(`
    COMMENT ON COLUMN executions.arn IS 'Execution ARN';
    COMMENT ON COLUMN executions.cumulus_version IS 'Cumulus version for the execution';
    COMMENT ON COLUMN executions.url IS 'Execution page url on AWS console';
    COMMENT ON COLUMN executions.status IS 'Execution status';
    COMMENT ON COLUMN executions.tasks IS 'List of completed workflow tasks';
    COMMENT ON COLUMN executions.error IS 'Error details in case of a failed execution';
    COMMENT ON COLUMN executions.workflow_name IS 'Name of the Cumulus workflow run in this execution';
    COMMENT ON COLUMN executions.duration IS 'Execution duration';
    COMMENT ON COLUMN executions.original_payload IS 'Original payload of this workflow';
    COMMENT ON COLUMN executions.final_payload IS 'Final payload of this workflow';
    COMMENT ON COLUMN executions."timestamp" IS 'Execution timestamp';
    COMMENT ON COLUMN executions.archived IS 'execution has been "archived"';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('executions');
};

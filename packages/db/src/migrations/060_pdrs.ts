import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('pdrs', (table) => {
    table.increments('cumulus_id').primary();

    table.integer('collection_cumulus_id')
      .references('cumulus_id')
      .inTable('collections')
      .notNullable();

    table.integer('provider_cumulus_id')
      .references('cumulus_id')
      .inTable('providers')
      .notNullable();

    table.bigInteger('execution_cumulus_id');
    table.timestamp('execution_created_at', { useTz: true, precision: 3 });

    table.foreign(['execution_cumulus_id', 'execution_created_at'])
      .references(['cumulus_id', 'created_at'])
      .inTable('executions')
      .onDelete('SET NULL');

    table.text('status').notNullable();
    table.text('name').notNullable();

    table.float('progress');
    table.boolean('pan_sent');
    table.text('pan_message');

    table.jsonb('stats');

    table.text('address');
    table.text('original_url');

    table.float('duration');

    table.timestamp('timestamp', { useTz: true });

    table.timestamps(false, true);

    table.unique(['name']);

    table.index(
      ['collection_cumulus_id', 'status', 'cumulus_id'],
      'pdrs_coll_status_cumulus_id_index'
    );

    table.index(
      ['execution_cumulus_id'],
      'pdrs_execution_cumulus_id_index'
    );

    table.index(
      ['provider_cumulus_id', 'collection_cumulus_id', 'name'],
      'pdrs_provider_collection_cumulus_id_name_index'
    );

    table.index(
      ['status', 'provider_cumulus_id', 'collection_cumulus_id', 'cumulus_id'],
      'pdrs_status_provider_collection_cumulus_id_index'
    );

    table.index(['updated_at'], 'pdrs_updated_at_index');
  });

  await knex.raw(`
    ALTER TABLE pdrs
    ADD CONSTRAINT pdrs_status_check
    CHECK (status = ANY (ARRAY[
      'running',
      'failed',
      'completed'
    ]));
  `);

  await knex.raw(`
    COMMENT ON COLUMN pdrs.cumulus_id IS 'Internal Cumulus ID for a PDR';
    COMMENT ON COLUMN pdrs.status IS 'Status (running, failed, completed) of the PDR';
    COMMENT ON COLUMN pdrs.name IS 'PDR name';
    COMMENT ON COLUMN pdrs.progress IS 'PDR completion progress percentage';
    COMMENT ON COLUMN pdrs.pan_sent IS 'Boolean defining if a PAN response has been sent for this PDR';
    COMMENT ON COLUMN pdrs.pan_message IS 'PAN message text';
    COMMENT ON COLUMN pdrs.stats IS 'PDR stats json object';
    COMMENT ON COLUMN pdrs."timestamp" IS 'PDR timestamp';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('pdrs');
};

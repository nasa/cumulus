import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules', (table) => {
    // Primary key
    table.bigIncrements('cumulus_id').primary();

    // Columns
    table.text('granule_id').notNullable();
    table.text('status').notNullable();

    table.integer('collection_cumulus_id').notNullable();

    table.timestamps(false, true);

    table.boolean('published');

    table.float('duration');
    table.float('time_to_archive');
    table.float('time_to_process');

    table.bigInteger('product_volume');

    table.jsonb('error');

    table.text('cmr_link');

    table.integer('pdr_cumulus_id');
    table.integer('provider_cumulus_id');

    table.timestamp('beginning_date_time', { useTz: true });
    table.timestamp('ending_date_time', { useTz: true });
    table.timestamp('last_update_date_time', { useTz: true });
    table.timestamp('processing_end_date_time', { useTz: true });
    table.timestamp('processing_start_date_time', { useTz: true });
    table.timestamp('production_date_time', { useTz: true });

    table.jsonb('query_fields');

    table.timestamp('timestamp', { useTz: true });

    table.text('producer_granule_id').notNullable();

    table.boolean('archived').notNullable().defaultTo(false);

    // Indexes
    table.index(['archived'], 'granules_archived_index');

    table.index(
      ['collection_cumulus_id', 'status', 'processing_end_date_time', 'cumulus_id'],
      'granules_coll_status_processendtime_cumulus_id_index'
    );

    table.index(
      ['collection_cumulus_id', 'updated_at'],
      'granules_collection_updated_idx'
    );

    table.index(['granule_id'], 'granules_granule_id_index');

    table.index(['producer_granule_id'], 'granules_producer_granule_id_index');

    table.index(
      ['provider_cumulus_id', 'collection_cumulus_id', 'granule_id'],
      'granules_provider_collection_cumulus_id_granule_id_index'
    );

    table.index(
      ['status', 'provider_cumulus_id', 'collection_cumulus_id', 'cumulus_id'],
      'granules_status_provider_collection_cumulus_id_index'
    );

    table.index(['updated_at'], 'granules_updated_at_index');
  });

  // Unique constraint
  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_collection_cumulus_id_granule_id_unique
    UNIQUE (collection_cumulus_id, granule_id);
  `);

  // CHECK constraint
  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_status_check
    CHECK (status = ANY (ARRAY[
      'running',
      'completed',
      'failed',
      'queued'
    ]));
  `);

  // Foreign keys
  // TODO create inline
  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_collection_cumulus_id_foreign
    FOREIGN KEY (collection_cumulus_id)
    REFERENCES collections(cumulus_id);
  `);

  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_pdr_cumulus_id_foreign
    FOREIGN KEY (pdr_cumulus_id)
    REFERENCES pdrs(cumulus_id);
  `);

  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_provider_cumulus_id_foreign
    FOREIGN KEY (provider_cumulus_id)
    REFERENCES providers(cumulus_id);
  `);

  // Comments
  await knex.raw(`
    COMMENT ON COLUMN granules.cumulus_id IS 'Internal Cumulus ID for a granule';
    COMMENT ON COLUMN granules.granule_id IS 'Granule ID';
    COMMENT ON COLUMN granules.status IS 'Ingest status of the granule';
    COMMENT ON COLUMN granules.published IS 'Flag that shows if the granule has been published in CMR';
    COMMENT ON COLUMN granules.duration IS 'Ingest duration';
    COMMENT ON COLUMN granules.time_to_archive IS 'Number of seconds granule took to archive';
    COMMENT ON COLUMN granules.time_to_process IS 'Number seconds granule took to complete "processing"';
    COMMENT ON COLUMN granules.error IS 'JSON error object';
    COMMENT ON COLUMN granules.cmr_link IS 'Link to granule in the CMR API';
    COMMENT ON COLUMN granules.beginning_date_time IS 'Date granule started';
    COMMENT ON COLUMN granules.ending_date_time IS 'Date granule completed';
    COMMENT ON COLUMN granules.last_update_date_time IS 'Timestamp for last update';
    COMMENT ON COLUMN granules.processing_end_date_time IS 'Date granule finished processing';
    COMMENT ON COLUMN granules.processing_start_date_time IS 'Date granule started processing';
    COMMENT ON COLUMN granules.production_date_time IS 'Timestamp for granule production date/time';
    COMMENT ON COLUMN granules.query_fields IS 'Arbitrary query fields for the granule';
    COMMENT ON COLUMN granules.producer_granule_id IS 'Producer Granule Id';
    COMMENT ON COLUMN granules.archived IS 'granule has been "archived"';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules');
};

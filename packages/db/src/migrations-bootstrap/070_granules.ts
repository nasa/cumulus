import { Knex } from 'knex';

const PARTITION_COUNT = 8;

export const up = async (knex: Knex): Promise<void> => {
  // Parent partitioned table
  await knex.raw(`
    CREATE TABLE granules (
      cumulus_id BIGSERIAL,
      granule_id TEXT NOT NULL,
      status TEXT NOT NULL,
      collection_cumulus_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
      published BOOLEAN,
      duration REAL,
      time_to_archive REAL,
      time_to_process REAL,
      product_volume BIGINT,
      error JSONB,
      cmr_link TEXT,
      pdr_cumulus_id INTEGER,
      provider_cumulus_id INTEGER,
      beginning_date_time TIMESTAMPTZ,
      ending_date_time TIMESTAMPTZ,
      last_update_date_time TIMESTAMPTZ,
      processing_end_date_time TIMESTAMPTZ,
      processing_start_date_time TIMESTAMPTZ,
      production_date_time TIMESTAMPTZ,
      query_fields JSONB,
      "timestamp" TIMESTAMPTZ,
      producer_granule_id TEXT NOT NULL,
      archived BOOLEAN DEFAULT FALSE NOT NULL,

      CONSTRAINT granules_pkey PRIMARY KEY (cumulus_id),

      CONSTRAINT granules_granule_id_unique UNIQUE (granule_id, cumulus_id)
    )
    PARTITION BY HASH (cumulus_id);
  `);

  // Create partitions
  await Promise.all(
    Array.from({ length: PARTITION_COUNT }).map((_, i) =>
      knex.raw(`
      CREATE TABLE granules_p${i}
      PARTITION OF granules
      FOR VALUES WITH (MODULUS ${PARTITION_COUNT}, REMAINDER ${i});
    `))
  );

  // Indexes (must be created on parent → propagates)
  await knex.raw(`
    CREATE INDEX granules_archived_index
      ON granules (archived);

    CREATE INDEX granules_coll_status_processendtime_cumulus_id_index
      ON granules (collection_cumulus_id, status, processing_end_date_time, cumulus_id);

    CREATE INDEX granules_collection_updated_idx
      ON granules (collection_cumulus_id, updated_at);

    CREATE INDEX granules_granule_id_index
      ON granules (granule_id);

    CREATE INDEX granules_producer_granule_id_index
      ON granules (producer_granule_id);

    CREATE INDEX granules_provider_collection_cumulus_id_granule_id_index
      ON granules (provider_cumulus_id, collection_cumulus_id, granule_id);

    CREATE INDEX granules_status_provider_collection_cumulus_id_index
      ON granules (status, provider_cumulus_id, collection_cumulus_id, cumulus_id);

    CREATE INDEX granules_updated_at_index
      ON granules (updated_at);
  `);

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

  // Foreign keys (must be added after)
  await knex.raw(`
    ALTER TABLE granules
    ADD CONSTRAINT granules_collection_cumulus_id_foreign
    FOREIGN KEY (collection_cumulus_id)
    REFERENCES collections(cumulus_id);

    ALTER TABLE granules
    ADD CONSTRAINT granules_pdr_cumulus_id_foreign
    FOREIGN KEY (pdr_cumulus_id)
    REFERENCES pdrs(cumulus_id);

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
  await knex.raw('DROP TABLE IF EXISTS granules CASCADE;');
};

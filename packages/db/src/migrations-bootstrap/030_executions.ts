import { Knex } from 'knex';
import { TIMESTAMP_PRECISION } from '../lib/migration';

const TOTAL_YEARS = Number(process.env.EXECUTIONS_PARTITION_TOTAL_YEARS ?? 2);

export const up = async (knex: Knex): Promise<void> => {
  // Parent partitioned table
  await knex.raw(`
    CREATE TABLE executions (
      cumulus_id BIGSERIAL,
      arn TEXT NOT NULL,

      async_operation_cumulus_id INTEGER,
      collection_cumulus_id INTEGER,
      parent_cumulus_id BIGINT,
      parent_created_at TIMESTAMPTZ(${TIMESTAMP_PRECISION}),

      cumulus_version TEXT,
      url TEXT,

      status TEXT NOT NULL,

      tasks JSONB,
      error JSONB,

      workflow_name TEXT,
      duration REAL,

      original_payload JSONB,
      final_payload JSONB,

      "timestamp" TIMESTAMPTZ(${TIMESTAMP_PRECISION}),

      created_at TIMESTAMPTZ(${TIMESTAMP_PRECISION}) DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TIMESTAMPTZ(${TIMESTAMP_PRECISION}) DEFAULT CURRENT_TIMESTAMP NOT NULL,

      archived BOOLEAN DEFAULT FALSE NOT NULL,

      CONSTRAINT executions_pkey PRIMARY KEY (cumulus_id, created_at),

      CONSTRAINT executions_arn_unique UNIQUE (arn, created_at),
      CONSTRAINT executions_url_unique UNIQUE (url, created_at)
    )
    PARTITION BY RANGE (created_at);
  `);

  // DEFAULT PARTITION (SAFETY NET)
  await knex.raw(`
    CREATE TABLE executions_default
    PARTITION OF executions
    DEFAULT;
  `);

  const currentYear = new Date().getFullYear();

  // QUARTERLY PARTITIONS
  const partitionQueries: string[] = [];
  for (let yearOffset = 0; yearOffset < TOTAL_YEARS; yearOffset += 1) {
    const y = currentYear + yearOffset;

    const quarters = [
      { name: 'q1', from: `${y}-01-01`, to: `${y}-04-01` },
      { name: 'q2', from: `${y}-04-01`, to: `${y}-07-01` },
      { name: 'q3', from: `${y}-07-01`, to: `${y}-10-01` },
      { name: 'q4', from: `${y}-10-01`, to: `${y + 1}-01-01` },
    ];

    quarters.forEach((q) => {
      partitionQueries.push(`
        CREATE TABLE executions_${y}_${q.name}
        PARTITION OF executions
        FOR VALUES FROM ('${q.from}') TO ('${q.to}');
      `);
    });
  }

  await knex.raw(partitionQueries.join('\n'));

  // INDEXES (on parent → propagate)
  await knex.raw(`
    CREATE INDEX executions_archived_index
      ON executions (archived);

    CREATE INDEX executions_collection_cumulus_id_index
      ON executions (collection_cumulus_id);

    CREATE INDEX executions_parent_cumulus_id_index
      ON executions (parent_cumulus_id, parent_created_at);

    CREATE INDEX executions_status_collection_cumulus_id_index
      ON executions (status, collection_cumulus_id, cumulus_id);

    CREATE INDEX executions_updated_at_index
      ON executions (updated_at);
  `);

  // FOREIGN KEYS
  await knex.raw(`
    ALTER TABLE executions
    ADD CONSTRAINT executions_async_operation_cumulus_id_foreign
    FOREIGN KEY (async_operation_cumulus_id)
    REFERENCES async_operations(cumulus_id);

    ALTER TABLE executions
    ADD CONSTRAINT executions_collection_cumulus_id_foreign
    FOREIGN KEY (collection_cumulus_id)
    REFERENCES collections(cumulus_id);

    ALTER TABLE executions
    ADD CONSTRAINT executions_parent_cumulus_id_foreign
    FOREIGN KEY (parent_cumulus_id, parent_created_at)
    REFERENCES executions (cumulus_id, created_at)
    ON DELETE SET NULL;
  `);

  // CHECK CONSTRAINT
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

  // COMMENTS
  await knex.raw(`
    COMMENT ON TABLE executions IS 'Table to store Step Function execution records';
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

  await knex.raw(`
    CREATE OR REPLACE PROCEDURE manage_executions_partitions(
      p_total_years_ahead INT,
      p_retention_years_past INT
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_current_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
      v_target_year  INT;
      v_quarter      INT;
      v_partition    TEXT;
      v_start_date   DATE;
      v_drop_record  RECORD;

      -- Variables for quarter-level retention calculation
      v_part_year    INT;
      v_part_quarter INT;
      v_part_end_date DATE;
      v_cutoff_date  DATE;
    BEGIN
      -- CREATE FUTURE PARTITIONS
      FOR v_target_year IN v_current_year..(v_current_year + p_total_years_ahead - 1) LOOP
        FOR v_quarter IN 1..4 LOOP
          v_partition  := format('executions_%s_q%s', v_target_year, v_quarter);
          v_start_date := make_date(v_target_year, ((v_quarter - 1) * 3) + 1, 1);

          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF executions
             FOR VALUES FROM (%L) TO (%L);',
            v_partition,
            v_start_date,
            v_start_date + INTERVAL '3 months'
          );
        END LOOP;
      END LOOP;

      -- DROP EXPIRED PARTITIONS
      IF p_retention_years_past IS NULL OR p_retention_years_past <= 0 THEN
        RAISE NOTICE 'Retention tracking disabled (value is NULL or <= 0). Skipping partition deletion phase.';
        RETURN;
      END IF;

      -- Calculate the exact cutoff date (e.g., exactly X years ago from today)
      v_cutoff_date := CURRENT_DATE - (p_retention_years_past || ' years')::INTERVAL;

      FOR v_drop_record IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename ~ '^executions_[0-9]{4}_q[1-4]$'
      LOOP
        -- Extract year and quarter from table name (e.g., 'executions_2024_q2')
        v_part_year    := (split_part(v_drop_record.tablename, '_', 2))::INT;
        v_part_quarter := (substring(split_part(v_drop_record.tablename, '_', 3) from '[1-4]'))::INT;

        -- get partition start date, add 3 months to avoid q4 month 13 error
        v_part_end_date := make_date(v_part_year, ((v_part_quarter - 1) * 3) + 1, 1) + INTERVAL '3 months';

        -- Debugging notice to evaluate dates prior to deletion check
        RAISE NOTICE 'Evaluating partition: %, Year: %, Quarter: %, End Date: %, Cutoff Date: %',
          v_drop_record.tablename,
          v_part_year,
          v_part_quarter,
          v_part_end_date,
          v_cutoff_date;

        -- Drop the partition only if its data is entirely older than the cutoff date
        IF v_part_end_date <= v_cutoff_date THEN
          RAISE NOTICE 'Deleting and dropping expired partition: %', v_drop_record.tablename;
          EXECUTE format('DELETE FROM %I;', v_drop_record.tablename);
          EXECUTE format('DROP TABLE IF EXISTS %I CASCADE;', v_drop_record.tablename);
        END IF;
      END LOOP;
    END $$;

    COMMENT ON PROCEDURE manage_executions_partitions(INT, INT) IS
    'Provisions future quarterly partitions and deletes expired ones older than the retention period.';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    DROP PROCEDURE IF EXISTS manage_executions_partitions(INT, INT);
  `);
  await knex.raw('DROP TABLE IF EXISTS executions CASCADE;');
};

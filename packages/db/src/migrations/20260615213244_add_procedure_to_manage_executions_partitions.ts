import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
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
};

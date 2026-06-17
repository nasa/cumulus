import { Knex } from 'knex';

const CREATE_FUTURE_PARTITIONS_PROC_NAME = 'create_future_executions_partitions';
const DELETE_EXPIRED_PARTITIONS_PROC_NAME = 'delete_expired_executions_partitions';

export const up = async (knex: Knex): Promise<void> => {
  // PROCEDURE TO CREATE FUTURE PARTITIONS
  await knex.raw(`
    CREATE OR REPLACE PROCEDURE ${CREATE_FUTURE_PARTITIONS_PROC_NAME}(
      p_total_years_ahead INT
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_current_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
      v_target_year  INT;
      v_quarter      INT;
      v_partition    TEXT;
      v_start_date   DATE;
    BEGIN
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
    END $$;

    COMMENT ON PROCEDURE ${CREATE_FUTURE_PARTITIONS_PROC_NAME}(INT) IS
    'procedure to provision future quarterly partitions for the executions table.';
  `);

  // PROCEDURE TO DROP EXPIRED PARTITIONS
  await knex.raw(`
    CREATE OR REPLACE PROCEDURE ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(
      p_retention_years_past INT,
      p_batch_size INT DEFAULT 10000
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_drop_record   RECORD;
      v_range_expr    TEXT;
      v_part_end_str  TEXT;
      v_part_end_date DATE;
      v_cutoff_date   DATE;
      v_rows_deleted  INT;
    BEGIN
      IF p_retention_years_past IS NULL OR p_retention_years_past <= 0 THEN
        RAISE NOTICE 'Retention tracking disabled (value is NULL or <= 0). Skipping partition deletion phase.';
        RETURN;
      END IF;

      -- calculate the exact cutoff date (e.g., exactly X years ago from today)
      v_cutoff_date := CURRENT_DATE - (p_retention_years_past || ' years')::INTERVAL;

      FOR v_drop_record IN
        SELECT
          c.oid,
          c.relname AS tablename,
          c.relpartbound
        FROM pg_inherits i
        JOIN pg_class AS p ON i.inhparent = p.oid
        JOIN pg_class AS c ON i.inhrelid = c.oid
        WHERE p.relname = 'executions'
      LOOP
        -- convert the internal binary range expression to a readable string
        -- e.g., "FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-04-01 00:00:00+00')"
        v_range_expr := pg_get_expr(v_drop_record.relpartbound, v_drop_record.oid);

        -- extract the upper date boundary substring via regex pattern matching
        -- looking for the string within the second set of single quotes after 'TO'
        v_part_end_str := substring(v_range_expr from 'TO .''([0-9]{4}-[0-9]{2}-[0-9]{2})');

        -- continue to next item safely if regex failed to extract a valid range format
        IF v_part_end_str IS NULL THEN
          CONTINUE;
        END IF;

        -- cast the isolated string directly into a standard date object
        v_part_end_date := v_part_end_str::DATE;

        -- debugging notice to evaluate ranges prior to execution checking
        RAISE NOTICE 'Evaluating partition: %, Range End: %, Cutoff Date: %',
          v_drop_record.tablename,
          v_part_end_date,
          v_cutoff_date;

        -- drop the partition only if its data window is entirely older than the cutoff date
        IF v_part_end_date <= v_cutoff_date THEN
          RAISE NOTICE 'Processing expired partition for safe batch cleanup: %', v_drop_record.tablename;

          -- BATCH CLEANUP: granules_executions (cte inner join delete)
          LOOP
            EXECUTE format('
              WITH batch AS (
                SELECT cumulus_id FROM %I LIMIT %L
              )
              DELETE FROM granules_executions ge
              USING batch b
              WHERE ge.execution_cumulus_id = b.cumulus_id;',
              v_drop_record.tablename, p_batch_size
            );
            GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
            COMMIT;
            EXIT WHEN v_rows_deleted = 0;
          END LOOP;

          -- BATCH CLEANUP: pdrs (cte inner join delete)
          LOOP
            EXECUTE format('
              WITH batch AS (
                SELECT cumulus_id FROM %I LIMIT %L
              )
              DELETE FROM pdrs p
              USING batch b
              WHERE p.execution_cumulus_id = b.cumulus_id;',
              v_drop_record.tablename, p_batch_size
            );
            GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
            COMMIT;
            EXIT WHEN v_rows_deleted = 0;
          END LOOP;

          -- BATCH CLEANUP: executions_global_unique (cte inner join delete)
          LOOP
            EXECUTE format('
              WITH batch AS (
                SELECT arn FROM %I LIMIT %L
              )
              DELETE FROM executions_global_unique gu
              USING batch b
              WHERE gu.arn = b.arn;',
              v_drop_record.tablename, p_batch_size
            );
            GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
            COMMIT;
            EXIT WHEN v_rows_deleted = 0;
          END LOOP;

          RAISE NOTICE 'Dropping expired partition: %', v_drop_record.tablename;
          EXECUTE format('DROP TABLE IF EXISTS %I CASCADE;', v_drop_record.tablename);
        END IF;
      END LOOP;
    END $$;

    COMMENT ON PROCEDURE ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(INT, INT) IS
    'procedure to delete expired executions partitions.';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`DROP PROCEDURE IF EXISTS ${CREATE_FUTURE_PARTITIONS_PROC_NAME}(INT);`);
  await knex.raw(`DROP PROCEDURE IF EXISTS ${DELETE_EXPIRED_PARTITIONS_PROC_NAME}(INT, INT);`);
};

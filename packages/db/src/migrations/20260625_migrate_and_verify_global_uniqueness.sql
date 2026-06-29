/*
============================================================================
SUMMARY:
    Migrates records from old non-partitioned tables into new HASH-partitioned
    uniqueness tables in batches of 500,000 rows with progress logging.
    If backup tables do not exist, it audits row counts against core data
    tables and throws an error on mismatch.

REQUIREMENT:
    Must run standalone. Do not execute inside an open transaction block.
============================================================================
*/

DO $$
DECLARE
    v_old_granules_exists BOOLEAN;
    v_old_files_exists    BOOLEAN;

    v_cnt_granules        BIGINT;
    v_cnt_granules_unique BIGINT;
    v_cnt_files           BIGINT;
    v_cnt_files_unique    BIGINT;
    v_total_to_migrate    BIGINT;

    v_batch_size          CONSTANT INT := 500000;
    v_rows_moved          INT;
    v_offset              INT;
    v_current_migrated    BIGINT;
BEGIN
    ---------------------------------------------------------------------------
    -- Granules Global Unique Processing
    ---------------------------------------------------------------------------
    SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'granules_global_unique_old_non_partitioned'
    ) INTO v_old_granules_exists;

    IF NOT v_old_granules_exists THEN
        -- Case A: Old backup table doesn't exist -> Compare table counts
        SELECT COUNT(*) INTO v_cnt_granules_unique FROM granules_global_unique;
        SELECT COUNT(*) INTO v_cnt_granules FROM granules;

        IF v_cnt_granules_unique <> v_cnt_granules THEN
            RAISE EXCEPTION 'Granule unique counts mismatch! Partitioned unique table has % rows, but base granules table has % rows.',
                v_cnt_granules_unique, v_cnt_granules;
        ELSE
            RAISE NOTICE 'Granules count matches (%). No synchronization needed.', v_cnt_granules;
        END IF;

    ELSE
        -- Case B: Old backup table exists -> Migrate from backup table using set-based chunks
        SELECT COUNT(*) FROM granules_global_unique_old_non_partitioned INTO v_total_to_migrate;
        RAISE NOTICE 'Backup table granules_global_unique_old_non_partitioned found. Total rows to migrate: %', v_total_to_migrate;

        v_offset := 0;
        v_current_migrated := 0;

        LOOP
            INSERT INTO granules_global_unique (granule_id)
            SELECT granule_id
            FROM granules_global_unique_old_non_partitioned
            ORDER BY granule_id
            LIMIT v_batch_size OFFSET v_offset
            ON CONFLICT DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;

            v_offset := v_offset + v_batch_size;
            v_current_migrated := v_current_migrated + v_rows_moved;

            RAISE NOTICE 'Granules Migration Progress: Migrated % / % rows (Offset: %)...',
                v_current_migrated, v_total_to_migrate, v_offset;

            COMMIT; -- Flushes the batch and drops locks
        END LOOP;

        EXECUTE 'DROP TABLE granules_global_unique_old_non_partitioned;';
        RAISE NOTICE 'Granules Migration Completed Successfully. Old table dropped. Total processed: % rows.', v_current_migrated;
    END IF;

    ---------------------------------------------------------------------------
    -- Files Global Unique Processing
    ---------------------------------------------------------------------------
    SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE tablename = 'files_global_unique_old_non_partitioned'
    ) INTO v_old_files_exists;

    IF NOT v_old_files_exists THEN
        -- Case A: Old backup table doesn't exist -> Compare table counts
        SELECT COUNT(*) INTO v_cnt_files_unique FROM files_global_unique;
        SELECT COUNT(*) INTO v_cnt_files FROM files;

        IF v_cnt_files_unique <> v_cnt_files THEN
            RAISE EXCEPTION 'File unique counts mismatch! Partitioned unique table has % rows, but base files table has % rows.',
                v_cnt_files_unique, v_cnt_files;
        ELSE
            RAISE NOTICE 'Files count matches (%). No synchronization needed.', v_cnt_files;
        END IF;

    ELSE
        -- Case B: Old backup table exists -> Migrate from backup table using set-based chunks
        SELECT COUNT(*) FROM files_global_unique_old_non_partitioned INTO v_total_to_migrate;
        RAISE NOTICE 'Backup table files_global_unique_old_non_partitioned found. Total rows to migrate: %', v_total_to_migrate;

        v_offset := 0;
        v_current_migrated := 0;

        LOOP
            INSERT INTO files_global_unique (bucket, key)
            SELECT bucket, key
            FROM files_global_unique_old_non_partitioned
            ORDER BY bucket, key
            LIMIT v_batch_size OFFSET v_offset
            ON CONFLICT DO NOTHING;

            GET DIAGNOSTICS v_rows_moved = ROW_COUNT;
            EXIT WHEN v_rows_moved = 0;

            v_offset := v_offset + v_batch_size;
            v_current_migrated := v_current_migrated + v_rows_moved;

            RAISE NOTICE 'Files Migration Progress: Migrated % / % rows (Offset: %)...',
                v_current_migrated, v_total_to_migrate, v_offset;

            COMMIT; -- Flushes the batch and drops locks
        END LOOP;

        EXECUTE 'DROP TABLE files_global_unique_old_non_partitioned;';
        RAISE NOTICE 'Files Migration Completed Successfully. Old table dropped. Total processed: % rows.', v_current_migrated;
    END IF;

    RAISE NOTICE 'Migration of Global Unique tables completed successfully.';
END $$;

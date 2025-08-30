import os
import getpass
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2

def log(message):
    print(f"[{datetime.now().isoformat()}] {message}")

def get_env_or_prompt(var_name, prompt_text, default=None, hide_input=False):
    val = os.getenv(var_name)
    if val is None:
        if hide_input:
            val = getpass.getpass(f"{prompt_text}: ")
        else:
            val = input(f"{prompt_text} [{default if default else ''}]: ").strip() or default
    return val

DB_HOST = get_env_or_prompt("DB_HOST", "Enter DB host")
DB_PORT = int(get_env_or_prompt("DB_PORT", "Enter DB port", "5432"))
DB_NAME = get_env_or_prompt("DB_NAME", "Enter DB name")
DB_USER = get_env_or_prompt("DB_USER", "Enter DB user")
DB_PASSWORD = get_env_or_prompt("DB_PASSWORD", "Enter DB password", hide_input=True)
BATCH_SIZE = int(get_env_or_prompt("BATCH_SIZE", "Enter BATCH SIZE for populating column", "100000"))
WORKERS = int(get_env_or_prompt("WORKERS", "Number of parallel workers", "1"))
RECOVERY_MODE = get_env_or_prompt("RECOVERY_MODE", "Batch Update Recovery mode? (Y/N)", "N").strip().upper() == "Y"

def get_conn(autocommit=False):
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    conn.autocommit = autocommit
    return conn

def check_for_duplicates():
    log("Checking for duplicate granule_id values...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT granule_id
                    FROM granules
                    GROUP BY granule_id
                    HAVING COUNT(*) > 1
                    LIMIT 1
                );
            """)
            exists, = cur.fetchone()
            if exists:
                raise Exception("Duplicate granule_id found. Exiting.")
    log("No duplicate granule_id values found.")

def add_column_if_needed():
    log("Adding column producer_granule_id if not present...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'granules' AND column_name = 'producer_granule_id'
                  ) THEN
                    ALTER TABLE granules ADD COLUMN producer_granule_id TEXT;
                    COMMENT ON COLUMN granules.producer_granule_id IS 'Producer Granule Id';
                  END IF;
                END$$;
            """)
            conn.commit()
    log("Column check complete.")

def disable_autovacuum():
    log("Disabling autovacuum on granules table...")
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE granules SET (autovacuum_enabled = false, toast.autovacuum_enabled = false);
            """)
        log("Autovacuum disabled.")

def enable_autovacuum():
    log("Re-enabling autovacuum on granules table...")
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE granules RESET (autovacuum_enabled, toast.autovacuum_enabled);
            """)
        log("Autovacuum re-enabled.")

def get_min_max_ids():
    log(f"Fetching min/max cumulus_id values ({'Recovery mode' if RECOVERY_MODE else 'Normal mode'})...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            if RECOVERY_MODE:
                cur.execute(f"""
                    SELECT MIN(cumulus_id), MAX(cumulus_id)
                    FROM granules
                    WHERE producer_granule_id IS NULL;
                """)
            else:
                cur.execute(f"""
                    SELECT MIN(cumulus_id), MAX(cumulus_id)
                    FROM granules;
                """)
            return cur.fetchone()

def process_batch(batch_range):
    start_id, end_id = batch_range
    conn = get_conn(autocommit=True)
    try:
        with conn.cursor() as cur:
            log(f"[Worker] Updating rows where cumulus_id BETWEEN {start_id} AND {end_id}")
            cur.execute(f"""
                UPDATE granules
                SET producer_granule_id = granule_id
                WHERE cumulus_id BETWEEN %s AND %s;
            """, (start_id, end_id))
            updated = cur.rowcount
            log(f"[Worker] Updated {updated} rows where cumulus_id BETWEEN {start_id} AND {end_id}")
    except Exception as e:
        log(f"[Worker] Failed batch {start_id}-{end_id}: {e}")
        raise
    finally:
        conn.close()

def run_parallel_batch_update(min_id, max_id):
    log(f"Starting parallel batch update with {WORKERS} worker(s)...")
    batch_ranges = [
        (start, min(start + BATCH_SIZE - 1, max_id))
        for start in range(min_id, max_id + 1, BATCH_SIZE)
    ]

    if WORKERS <= 1:
        for batch in batch_ranges:
            process_batch(batch)
    else:
        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = {executor.submit(process_batch, br): br for br in batch_ranges}
            for future in as_completed(futures):
                batch = futures[future]
                try:
                    future.result()
                except Exception as e:
                    log(f"[ERROR] Batch {batch} failed: {e}")
                    raise
    log("Parallel batch update complete.")

def set_column_not_null():
    log("Setting producer_granule_id column to NOT NULL...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                ALTER TABLE granules
                ALTER COLUMN producer_granule_id SET NOT NULL;
            """)
            conn.commit()
    log("Column is now NOT NULL.")

def create_index():
    log("Creating index on producer_granule_id...")
    # "CREATE INDEX CONCURRENTLY" cannot be executed inside a transaction block
    conn =  get_conn(autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(f"""
            CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_producer_granule_id_index
            ON granules (producer_granule_id);
        """)
        cur.close()
        log("Index created.")
    finally:
        conn.close()

def vacuum_table():
    log("Vacuuming granules table...")
    # VACUUM cannot be executed inside a transaction block
    conn =  get_conn(autocommit=True)
    try:
        cur = conn.cursor()
        cur.execute(f"""
            VACUUM (VERBOSE, ANALYZE) granules;
        """)
        cur.close()
        log("Vacuum complete.")
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        check_for_duplicates()
        add_column_if_needed()
        disable_autovacuum()

        min_id, max_id = get_min_max_ids()
        if min_id is None or max_id is None:
            log("No rows to populate.")
        else:
            log(f"Populating cumulus_id range: {min_id} to {max_id}")
            run_parallel_batch_update(min_id, max_id)

        set_column_not_null()
        vacuum_table()
        create_index()
        enable_autovacuum()
        log("Update completed successfully.")
    except Exception as err:
        log(f"Aborted: {err}")
        enable_autovacuum()

import os
import getpass
from datetime import datetime

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

TABLE_NAME = "granules"
COLUMN_NAME = "producer_granule_id"

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
                    WHERE table_name = '{TABLE_NAME}' AND column_name = '{COLUMN_NAME}'
                  ) THEN
                    ALTER TABLE {TABLE_NAME} ADD COLUMN {COLUMN_NAME} TEXT;
                    COMMENT ON COLUMN {TABLE_NAME}.{COLUMN_NAME} IS 'Producer Granule Id';
                  END IF;
                END$$;
            """)
            conn.commit()
    log("Column check complete.")

def get_min_max_ids():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT MIN(cumulus_id), MAX(cumulus_id) FROM {TABLE_NAME}")
            return cur.fetchone()

def batch_update(min_id, max_id):
    log("Starting batch update using a single connection...")
    log(f"min_id {min_id} AND max_id {max_id}")

    # Run each batch as its own statement outside of an explicit transaction block
    # autocommit=True ensures each UPDATE is committed immediately
    conn =  get_conn(autocommit=True)
    try:
        cur = conn.cursor()
        while min_id <= max_id:
            upper = min_id + BATCH_SIZE - 1
            log(f"Updating rows where cumulus_id BETWEEN {min_id} AND {upper}")

            cur.execute(f"""
                UPDATE {TABLE_NAME}
                SET {COLUMN_NAME} = granule_id
                WHERE cumulus_id BETWEEN %s AND %s;
            """, (min_id, upper))

            updated = cur.rowcount
            log(f"Updated {updated} rows where cumulus_id BETWEEN {min_id} AND {upper}")
            min_id += BATCH_SIZE

        cur.close()
    except Exception as e:
        log(f"Failed batch update: {e}")
        raise
    finally:
        conn.close()

    log("Finished populating producer_granule_id column.")

def set_column_not_null():
    log("Setting producer_granule_id column to NOT NULL...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                ALTER TABLE {TABLE_NAME}
                ALTER COLUMN {COLUMN_NAME} SET NOT NULL;
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
            CREATE INDEX CONCURRENTLY IF NOT EXISTS {TABLE_NAME}_{COLUMN_NAME}_index
            ON {TABLE_NAME} ({COLUMN_NAME});
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
            VACUUM (ANALYZE, VERBOSE) {TABLE_NAME};
        """)
        cur.close()
        log("Vacuum complete.")
    finally:
        conn.close()

if __name__ == "__main__":
    try:
        check_for_duplicates()
        add_column_if_needed()
        min_id, max_id = get_min_max_ids()
        if min_id is None or max_id is None:
            log("The granules table is empty.")
        else:
            batch_update(min_id, max_id)
            set_column_not_null()
            create_index()
            vacuum_table()
            log("Update completed successfully.")
    except Exception as err:
        log(f"Aborted: {err}")

import psycopg2
import os
from datetime import datetime

def log(message):
    print(f"[{datetime.now().isoformat()}] {message}")

def get_env_or_prompt(var_name, prompt_text, default=None):
    val = os.getenv(var_name)
    if val is None:
        val = input(f"{prompt_text} [{default if default else ''}]: ") or default
    return val

DB_HOST = get_env_or_prompt("DB_HOST", "Enter DB host")
DB_PORT = int(get_env_or_prompt("DB_PORT", "Enter DB port", "5432"))
DB_NAME = get_env_or_prompt("DB_NAME", "Enter DB name")
DB_USER = get_env_or_prompt("DB_USER", "Enter DB user")
DB_PASSWORD = get_env_or_prompt("DB_PASSWORD", "Enter DB password")

TABLE_NAME = "granules"
COLUMN_NAME = "producer_granule_id"
BATCH_SIZE = 100_000

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

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                while min_id <= max_id:
                    upper = min_id + BATCH_SIZE - 1
                    log(f"Updating rows where cumulus_id BETWEEN {min_id} AND {upper}")

                    cur.execute(f"""
                        UPDATE {TABLE_NAME}
                        SET {COLUMN_NAME} = granule_id
                        WHERE cumulus_id BETWEEN %s AND %s;
                    """, (min_id, upper))

                    conn.commit()  # commit after each batch
                    min_id += BATCH_SIZE
    except Exception as e:
        log(f"Failed batch update: {e}")
        raise

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
    with get_conn(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS {TABLE_NAME}_{COLUMN_NAME}_idx
                ON {TABLE_NAME} ({COLUMN_NAME});
            """)
    log("Index created.")

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
            log("Update completed successfully.")
    except Exception as err:
        log(f"Aborted: {err}")

export const asyncOperationsS3TableSql = (tableName: string = 'async_operations') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    id UUID NOT NULL,
    description TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    output JSON,
    status TEXT NOT NULL,
    task_arn TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT async_operations_id_unique UNIQUE (id),
    CONSTRAINT async_operations_status_check
        CHECK (status IN (
            'RUNNING',
            'SUCCEEDED',
            'RUNNER_FAILED',
            'TASK_FAILED'
        )),
    CONSTRAINT async_operations_operation_type_check
        CHECK (operation_type IN (
            'Bulk Execution Archive',
            'Bulk Execution Delete',
            'Bulk Granules',
            'Bulk Granule Archive',
            'Bulk Granule Delete',
            'Bulk Granule Reingest',
            'Data Migration',
            'Dead-Letter Processing',
            'DLA Migration',
            'ES Index',
            'Kinesis Replay',
            'Migration Count Report',
            'Reconciliation Report',
            'SQS Replay'
        ))
);`;

export const collectionsS3TableSql = (tableName: string = 'collections') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    sample_file_name TEXT NOT NULL,
    granule_id_validation_regex TEXT NOT NULL,
    granule_id_extraction_regex TEXT NOT NULL,
    files JSON NOT NULL,
    process TEXT,
    url_path TEXT,
    duplicate_handling TEXT,
    report_to_ems BOOLEAN,
    ignore_files_config_for_discovery BOOLEAN,
    meta JSON,
    tags JSON,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, version),
    CHECK (duplicate_handling IN ('error', 'replace', 'skip', 'version'))
);`;

export const executionsS3TableSql = (tableName: string = 'executions') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id BIGINT PRIMARY KEY,
    arn TEXT NOT NULL,
    async_operation_cumulus_id INTEGER,
    collection_cumulus_id INTEGER,
    parent_cumulus_id BIGINT,
    cumulus_version TEXT,
    url TEXT,
    status TEXT NOT NULL,
    tasks JSON,
    error JSON,
    workflow_name TEXT,
    duration REAL,
    original_payload JSON,
    final_payload JSON,
    "timestamp" TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT executions_arn_unique UNIQUE (arn),
    CONSTRAINT executions_url_unique UNIQUE (url),
    CONSTRAINT executions_async_operation_cumulus_id_foreign
        FOREIGN KEY (async_operation_cumulus_id)
        REFERENCES async_operations (cumulus_id),
    CONSTRAINT executions_collection_cumulus_id_foreign
        FOREIGN KEY (collection_cumulus_id)
        REFERENCES collections (cumulus_id),
    CONSTRAINT executions_parent_cumulus_id_foreign
        FOREIGN KEY (parent_cumulus_id)
        REFERENCES ${tableName} (cumulus_id),
    CONSTRAINT executions_status_check
        CHECK (status IN ('running', 'completed', 'failed', 'unknown'))
);`;

export const filesS3TableSql = (tableName: string = 'files') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id BIGINT PRIMARY KEY,
    granule_cumulus_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_size BIGINT,
    bucket TEXT NOT NULL,
    checksum_type TEXT,
    checksum_value TEXT,
    file_name TEXT,
    key TEXT NOT NULL,
    path TEXT,
    source TEXT,
    type TEXT,
    CONSTRAINT files_bucket_key_unique UNIQUE (bucket, key),
    CONSTRAINT files_granule_cumulus_id_foreign
        FOREIGN KEY (granule_cumulus_id)
        REFERENCES granules (cumulus_id)
);`;

export const granulesS3TableSql = (tableName: string = 'granules') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id BIGINT PRIMARY KEY,
    granule_id TEXT NOT NULL,
    status TEXT NOT NULL,
    collection_cumulus_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published BOOLEAN,
    duration REAL,
    time_to_archive REAL,
    time_to_process REAL,
    product_volume BIGINT,
    error JSON,
    cmr_link TEXT,
    pdr_cumulus_id INTEGER,
    provider_cumulus_id INTEGER,
    beginning_date_time TIMESTAMPTZ,
    ending_date_time TIMESTAMPTZ,
    last_update_date_time TIMESTAMPTZ,
    processing_end_date_time TIMESTAMPTZ,
    processing_start_date_time TIMESTAMPTZ,
    production_date_time TIMESTAMPTZ,
    query_fields JSON,
    "timestamp" TIMESTAMPTZ,
    producer_granule_id TEXT NOT NULL,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (collection_cumulus_id, granule_id),
    CHECK (status IN ('running', 'completed', 'failed', 'queued'))
);`;

export const granulesExecutionsS3TableSql = (tableName: string = 'granules_executions') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    granule_cumulus_id BIGINT NOT NULL,
    execution_cumulus_id BIGINT NOT NULL,
    CONSTRAINT granules_executions_granule_execution_unique
        UNIQUE (granule_cumulus_id, execution_cumulus_id),
    CONSTRAINT granules_executions_execution_cumulus_id_foreign
        FOREIGN KEY (execution_cumulus_id)
        REFERENCES executions (cumulus_id),
    CONSTRAINT granules_executions_granule_cumulus_id_foreign
        FOREIGN KEY (granule_cumulus_id)
        REFERENCES granules (cumulus_id)
);`;

export const pdrsS3TableSql = (tableName: string = 'pdrs') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    collection_cumulus_id INTEGER NOT NULL,
    provider_cumulus_id INTEGER NOT NULL,
    execution_cumulus_id BIGINT,
    status TEXT NOT NULL,
    name TEXT NOT NULL,
    progress REAL,
    pan_sent BOOLEAN,
    pan_message TEXT,
    stats JSON,
    address TEXT,
    original_url TEXT,
    duration REAL,
    "timestamp" TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pdrs_name_unique UNIQUE (name),
    CONSTRAINT pdrs_collection_cumulus_id_foreign
        FOREIGN KEY (collection_cumulus_id)
        REFERENCES collections (cumulus_id),
    CONSTRAINT pdrs_execution_cumulus_id_foreign
        FOREIGN KEY (execution_cumulus_id)
        REFERENCES executions (cumulus_id),
    CONSTRAINT pdrs_provider_cumulus_id_foreign
        FOREIGN KEY (provider_cumulus_id)
        REFERENCES providers (cumulus_id),
    CONSTRAINT pdrs_status_check
        CHECK (status IN ('running', 'failed', 'completed'))
);`;

export const providersS3TableSql = (tableName: string = 'providers') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'http',
    host TEXT NOT NULL,
    port INTEGER,
    username TEXT,
    password TEXT,
    global_connection_limit INTEGER,
    private_key TEXT,
    cm_key_id TEXT,
    certificate_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    allowed_redirects TEXT[],
    max_download_time INTEGER,
    CONSTRAINT providers_name_unique UNIQUE (name),
    CONSTRAINT providers_protocol_check
        CHECK (protocol IN ('http', 'https', 'ftp', 'sftp', 's3'))
);`;

export const reconciliationReportsS3TableSql = (tableName: string = 'reconciliation_reports') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    location TEXT,
    error JSON,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reconciliation_reports_name_unique UNIQUE (name),
    CONSTRAINT reconciliation_reports_type_check
        CHECK (type IN (
            'Granule Inventory',
            'Granule Not Found',
            'Internal',
            'Inventory',
            'ORCA Backup'
        )),
    CONSTRAINT reconciliation_reports_status_check
        CHECK (status IN ('Generated', 'Pending', 'Failed'))
);`;

export const rulesS3TableSql = (tableName: string = 'rules') => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    cumulus_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    workflow TEXT NOT NULL,
    collection_cumulus_id INTEGER,
    provider_cumulus_id INTEGER,
    type TEXT NOT NULL,
    enabled BOOLEAN NOT NULL,
    value TEXT,
    arn TEXT,
    log_event_arn TEXT,
    execution_name_prefix TEXT,
    payload JSON,
    meta JSON,
    tags JSON,
    queue_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rules_name_unique UNIQUE (name),
    CONSTRAINT rules_collection_cumulus_id_foreign
        FOREIGN KEY (collection_cumulus_id)
        REFERENCES collections (cumulus_id),
    CONSTRAINT rules_provider_cumulus_id_foreign
        FOREIGN KEY (provider_cumulus_id)
        REFERENCES providers (cumulus_id),
    CONSTRAINT rules_type_check
        CHECK (type IN ('onetime', 'scheduled', 'sns', 'kinesis', 'sqs'))
);`;

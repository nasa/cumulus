import { AsyncOperationStatus, AsyncOperationType } from '@cumulus/types/api/async_operations';

export interface PostgresAsyncOperation {
  id: string
  description: string
  operation_type: AsyncOperationType
  status: AsyncOperationStatus
  output?: Object
  task_arn?: string
  created_at?: Date
  updated_at?: Date
}

export interface PostgresAsyncOperationRecord extends PostgresAsyncOperation {
  created_at: Date
  updated_at: Date
}

export interface PostgresCollection {
  name: string
  version: string
  granule_id_validation_regex: string
  granule_id_extraction_regex: string
  files: string
  process?: string
  duplicate_handling?: string
  report_to_ems?: boolean
  sample_file_name?: string
  url_path?: string
  ignore_files_config_for_discovery?: boolean
  meta?: string
  tags?: string
  created_at?: Date
  updated_at?: Date
}

export interface PostgresCollectionRecord extends PostgresCollection {
  created_at: Date
  updated_at: Date
}

export interface ExecutionRecord {
  arn: string
  async_operation_cumulus_id?: number
  collection_cumulus_id?: number
  parent_cumulus_id?: number
  cumulus_version: string
  created_at: Date
  updated_at: Date
}

export interface ProviderRecord {
  name: string
  protocol: string
  host: string
  port?: number
  username?: string
  password?: string
  global_connection_limit?: number
  private_key?: string
  cm_key_id?: string
  certificate_uri?: string
  created_at: Date
  updated_at: Date
}

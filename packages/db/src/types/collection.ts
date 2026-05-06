import { DuplicateHandling } from '@cumulus/types';

export interface PostgresCollection {
  cmr_provider: string,
  files: string,
  granule_id_validation_regex: string,
  granule_id_extraction_regex: string,
  name: string,
  sample_file_name: string,
  version: string,
  created_at?: Date,
  duplicate_handling?: DuplicateHandling,
  ignore_files_config_for_discovery?: boolean,
  meta?: object,
  process?: string,
  report_to_ems?: boolean,
  tags?: string,
  updated_at?: Date,
  url_path?: string,
}

export interface PostgresCollectionRecord extends Omit<PostgresCollection, 'tags'> {
  created_at: Date,
  cumulus_id: number,
  updated_at: Date,
  tags: string[],
}

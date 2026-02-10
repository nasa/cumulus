import { DuplicateHandling } from '@cumulus/types';

export interface PostgresCollection {
  cmr_provider?: string,
  created_at?: Date,
  duplicate_handling?: DuplicateHandling,
  files: string,
  granule_id_validation_regex: string,
  granule_id_extraction_regex: string,
  ignore_files_config_for_discovery?: boolean,
  meta?: object,
  name: string,
  process?: string,
  report_to_ems?: boolean,
  sample_file_name: string,
  tags?: string,
  updated_at?: Date,
  url_path?: string,
  version: string,
}

export interface PostgresCollectionRecord extends Omit<PostgresCollection, 'tags'> {
  created_at: Date,
  cumulus_id: number,
  updated_at: Date,
  tags: string[],
}

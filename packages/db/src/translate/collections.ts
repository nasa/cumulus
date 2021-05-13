import { NewCollectionRecord, PartialCollectionRecord } from '@cumulus/types/api/collections';
import { PostgresCollection } from '../types/collection';

export const translateApiCollectionToPostgresCollection = (
  record: NewCollectionRecord
): PostgresCollection => {
  // Map old record to new schema.
  const translatedRecord: PostgresCollection = {
    name: record.name,
    version: record.version,
    process: record.process,
    url_path: record.url_path,
    duplicate_handling: record.duplicateHandling,
    granule_id_validation_regex: record.granuleId,
    granule_id_extraction_regex: record.granuleIdExtraction,
    // have to stringify on an array of values
    files: (JSON.stringify(record.files)),
    report_to_ems: record.reportToEms,
    sample_file_name: record.sampleFileName,
    ignore_files_config_for_discovery: record.ignoreFilesConfigForDiscovery,
    meta: (record.meta ? JSON.stringify(record.meta) : undefined),
    // have to stringify on an array of values
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
  };
  if (record.createdAt !== undefined) {
    translatedRecord.created_at = new Date(record.createdAt);
  }
  if (record.updatedAt !== undefined) {
    translatedRecord.updated_at = new Date(record.updatedAt);
  }
  return translatedRecord;
};

export const translatePostgresCollectionToApiCollection = (
  record: PostgresCollection
) => {
  // Map old record to new schema.
  const translatedRecord: PartialCollectionRecord = {
    name: record.name,
    version: record.version,
    process: record.process,
    url_path: record.url_path,
    duplicateHandling: record.duplicate_handling,
    granuleId: record.granule_id_validation_regex,
    granuleIdExtraction: record.granule_id_extraction_regex,
    files: JSON.parse(record.files),
    reportToEms: record.report_to_ems,
    sampleFileName: record.sample_file_name,
    ignoreFilesConfigForDiscovery: record.ignore_files_config_for_discovery,
    meta: record.meta ? JSON.parse(record.meta) : undefined,
    tags: record.tags ? JSON.parse(record.tags) : undefined,
  };
  if (record.created_at !== undefined) {
    translatedRecord.createdAt = record.created_at.getTime();
  }
  if (record.updated_at !== undefined) {
    translatedRecord.updatedAt = record.updated_at.getTime();
  }
  return translatedRecord;
};

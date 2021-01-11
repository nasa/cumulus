import { ApiFile } from '@cumulus/types/api/files';

import { PostgresFile } from '../types/file';

export const translateApiFiletoPostgresFile = (
  file: ApiFile
): Omit<PostgresFile, 'granule_cumulus_id'> => ({
  bucket: file.bucket,
  checksum_type: file.checksumType,
  checksum_value: file.checksum,
  file_name: file.fileName,
  key: file.key,
  path: file.path,
  file_size: file.size,
  source: file.source,
});

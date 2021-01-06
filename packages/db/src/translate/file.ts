import { ApiFile } from '@cumulus/types/api/files';

import { PostgresFile } from '../types/file';

export const translateApiFiletoPostgresFile = (
  file: ApiFile
): Omit<PostgresFile, 'granule_cumulus_id'> => ({
  bucket: file.bucket,
  checksum_type: file.checksumType,
  checksum_value: file.checksum,
  // TODO: do we really need both of these properties?
  filename: file.fileName,
  file_name: file.fileName,
  key: file.key,
  name: file.name,
  path: file.path,
  size: file.size,
  source: file.source,
});

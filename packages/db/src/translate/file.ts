import { ApiFile } from '@cumulus/types/api/files';
import { ValidationError } from '@cumulus/errors';

import { PostgresFile } from '../types/file';

export const translateApiFiletoPostgresFile = (
  file: ApiFile
): Omit<PostgresFile, 'granule_cumulus_id'> => {
  if (!file.bucket || !file.key) throw new ValidationError(`bucket and key properties are required: ${file}`);

  return {
    bucket: file.bucket,
    key: file.key,
    checksum_type: file.checksumType,
    checksum_value: file.checksum,
    file_name: file.fileName,
    file_size: file.size,
    path: file.path,
    source: file.source,
  };
};

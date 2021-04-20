import { ApiFile } from '@cumulus/types/api/files';

import { PostgresFile } from '../types/file';

const { parseS3Uri } = require('@cumulus/aws-client/S3');

const getBucket = (file: ApiFile): string | undefined => {
  if (file.bucket) return file.bucket;
  if (file.filename) return parseS3Uri(file.filename).Bucket;
  return undefined;
};

const getKey = (file: ApiFile) => {
  if (file.key) return file.key;
  if (file.filename) return parseS3Uri(file.filename).Key;
  return undefined;
};

export const translateApiFiletoPostgresFile = (
  file: ApiFile
): Omit<PostgresFile, 'granule_cumulus_id'> => {
  const bucket = getBucket(file);
  const key = getKey(file);

  return {
    bucket,
    key,
    checksum_type: file.checksumType,
    checksum_value: file.checksum,
    file_name: file.fileName,
    file_size: file.size,
    path: file.path,
    source: file.source,
  };
};

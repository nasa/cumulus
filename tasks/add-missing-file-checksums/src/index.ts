import * as awsClients from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import { Granule, GranuleFile, HandlerEvent } from './types';

const validateGranuleFile = (granuleFile: GranuleFile) => {
  if (granuleFile.checksumType && !granuleFile.checksum) {
    throw new TypeError(
      `checksumType is set but checksum is not: ${JSON.stringify(granuleFile)}`
    );
  }

  if (granuleFile.checksum && !granuleFile.checksumType) {
    throw new TypeError(
      `checksum is set but checksumType is not: ${JSON.stringify(granuleFile)}`
    );
  }
};

const parseS3Uri = (uri: string) => {
  const { Bucket, Key } = S3.parseS3Uri(uri);

  if (!Bucket) {
    throw new TypeError(
      `Unable to determine S3 bucket from ${uri}`
    );
  }

  if (!Key) {
    throw new TypeError(
      `Unable to determine S3 key from ${uri}`
    );
  }

  return { bucket: Bucket, key: Key };
};

const calculateGranuleFileChecksum = async (params: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;

  const { bucket, key } = parseS3Uri(granuleFile.filename);

  return S3.calculateObjectHash({
    s3,
    algorithm,
    bucket: bucket,
    key: key
  });
};

const granuleFileHasChecksum = (granuleFile: GranuleFile) =>
  granuleFile.checksumType && granuleFile.checksum;

export const addChecksumToGranuleFile = async (params: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;

  validateGranuleFile(granuleFile);

  if (granuleFileHasChecksum(granuleFile)) {
    return granuleFile;
  }

  const checksum = await calculateGranuleFileChecksum({
    s3,
    algorithm,
    granuleFile
  });

  return <GranuleFile>{
    ...granuleFile,
    checksumType: algorithm,
    checksum
  };
};

const addFileChecksumsToGranule = async (params: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granule: Granule
}) => {
  const { s3, granule, algorithm } = params;

  const filesWithChecksums = await Promise.all(
    params.granule.files.map(
      (granuleFile) => addChecksumToGranuleFile({
        s3: s3,
        algorithm,
        granuleFile
      })
    )
  );

  return {
    ...granule,
    files: filesWithChecksums
  };
};

export const handler = async (event: HandlerEvent) => {
  const { config, input } = event;

  const granulesWithChecksums = await Promise.all(
    input.granules.map(
      (granule) => addFileChecksumsToGranule({
        s3: awsClients.s3(),
        algorithm: config.algorithm,
        granule
      })
    )
  );

  return { granules: granulesWithChecksums };
};

// export const cmaHandler = (event, context) =>
//   runCumulusTask(handler, event, context);

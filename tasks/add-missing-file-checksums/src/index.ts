import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import * as awsClients from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import { Context } from 'aws-lambda';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { Granule, GranuleFile, HandlerInput, HandlerEvent } from './types';

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
  s3: { getObject: S3.GetObjectCreateReadStreamMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;

  const { bucket, key } = parseS3Uri(granuleFile.filename);

  return S3.calculateObjectHash({ s3, algorithm, bucket, key });
};

const granuleFileHasPartialChecksum = (granuleFile: GranuleFile) =>
  (granuleFile.checksumType && !granuleFile.checksum)
  || (granuleFile.checksum && !granuleFile.checksumType);

const granuleFileHasChecksum = (granuleFile: GranuleFile) =>
  granuleFile.checksumType && granuleFile.checksum;

const granuleFileDoesNotHaveFilename = (granuleFile: GranuleFile) =>
  !granuleFile.filename;

const skipGranuleFileUpdate = (granuleFile: GranuleFile) =>
  granuleFileHasChecksum(granuleFile)
  || granuleFileHasPartialChecksum(granuleFile)
  || granuleFileDoesNotHaveFilename(granuleFile);

export const addChecksumToGranuleFile = async (params: {
  s3: { getObject: S3.GetObjectCreateReadStreamMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;

  if (skipGranuleFileUpdate(granuleFile)) {
    return granuleFile;
  }

  const checksum = await calculateGranuleFileChecksum({
    s3,
    algorithm,
    granuleFile,
  });

  return <GranuleFile>{
    ...granuleFile,
    checksumType: algorithm,
    checksum,
  };
};

const addFileChecksumsToGranule = async (params: {
  s3: { getObject: S3.GetObjectCreateReadStreamMethod },
  algorithm: string,
  granule: Granule
}) => {
  const { s3, granule, algorithm } = params;

  const filesWithChecksums = await Promise.all(
    params.granule.files.map(
      (granuleFile) => addChecksumToGranuleFile({
        s3: s3,
        algorithm,
        granuleFile,
      })
    )
  );

  return {
    ...granule,
    files: filesWithChecksums,
  };
};

export const handler = async (event: HandlerEvent) => {
  const { config, input } = event;
  const granulesWithChecksums = await Promise.all(
    input.granules.map(
      (granule) => addFileChecksumsToGranule({
        s3: awsClients.s3(),
        algorithm: config.algorithm,
        granule,
      })
    )
  );

  return <HandlerInput>{
    ...input,
    granules: granulesWithChecksums,
  };
};

export const cmaHandler = (event: CumulusMessage | CumulusRemoteMessage, context: Context) =>
  runCumulusTask(handler, event, context);

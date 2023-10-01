import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import * as awsClients from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import { Context } from 'aws-lambda';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { Granule, GranuleFile, HandlerInput, HandlerEvent } from './types';

/**
 * Calculate checksum for a granule file.
 */
const calculateGranuleFileChecksum = async ({
                                              s3,
                                              algorithm,
                                              granuleFile: { bucket, key }
                                            }: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}): Promise<string> => {
  return await S3.calculateObjectHash({ s3, algorithm, bucket, key });
};

const granuleFileHasPartialChecksum = (granuleFile: GranuleFile) =>
    (granuleFile.checksumType && !granuleFile.checksum)
    || (granuleFile.checksum && !granuleFile.checksumType);

const granuleFileHasChecksum = (granuleFile: GranuleFile) =>
    granuleFile.checksumType && granuleFile.checksum;

const granuleFileDoesNotHaveBucketAndKey = (granuleFile: GranuleFile) =>
    !granuleFile.bucket || !granuleFile.key;

const skipGranuleFileUpdate = (granuleFile: GranuleFile) =>
    granuleFileHasChecksum(granuleFile)
    || granuleFileHasPartialChecksum(granuleFile)
    || granuleFileDoesNotHaveBucketAndKey(granuleFile);

/**
 * Add checksum to a granule file.
 */
export const addChecksumToGranuleFile = async ({
                                                 s3,
                                                 algorithm,
                                                 granuleFile
                                               }: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}): Promise<GranuleFile> => {
  if (skipGranuleFileUpdate(granuleFile)) {
    return granuleFile;
  }

  const checksum = await calculateGranuleFileChecksum({ s3, algorithm, granuleFile });

  return {
    ...granuleFile,
    checksumType: algorithm,
    checksum,
  };
};

/**
 * Add checksums to all files of a granule.
 */
const addFileChecksumsToGranule = async ({
                                           s3,
                                           algorithm,
                                           granule
                                         }: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granule: Granule
}): Promise<Granule> => {
  const filesWithChecksums = await Promise.all(
      granule.files.map((file) => addChecksumToGranuleFile({ s3, algorithm, granuleFile: file }))
  );

  return {
    ...granule,
    files: filesWithChecksums,
  };
};

/**
 * Main handler function.
 */
export const handler = async (event: HandlerEvent): Promise<HandlerInput> => {
  const { config, input } = event;
  const s3 = awsClients.s3();
  const granulesWithChecksums = await Promise.all(
      input.granules.map((granule) => addFileChecksumsToGranule({ s3, algorithm: config.algorithm, granule }))
  );

  return {
    ...input,
    granules: granulesWithChecksums,
  };
};

/**
 * CMA handler function.
 */
export const cmaHandler = async (
    event: CumulusMessage | CumulusRemoteMessage,
    context: Context
): Promise<HandlerInput> => {
  return await runCumulusTask(handler, event, context);
};
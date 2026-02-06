import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import * as awsClients from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import { Context } from 'aws-lambda';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import crypto from 'crypto';
import type { Readable } from 'stream';
import { Granule, GranuleFile, HandlerInput, HandlerEvent } from './types';

const updateHashFromBody = async (hash: crypto.Hash,
  body: Readable | Buffer | Uint8Array | string) => {
  if (!body) return;

  // Node readable stream
  if (typeof (body as Readable).on === 'function') {
    await new Promise<void>((resolve, reject) => {
      (body as Readable).on('data', (chunk: any) => hash.update(chunk as any));
      (body as Readable).on('end', resolve);
      (body as Readable).on('error', reject);
    });
    return;
  }

  // Set to Uint8Array if not a stream
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  hash.update(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
};

const calculateObjectHashByRanges = async (params: {
  s3: { getObject: S3.GetObjectMethod }
  algorithm: string,
  bucket: string,
  key: string,
  size: number,
  partSizeBytes: number
}) => {
  const {
    s3, algorithm, bucket, key, size, partSizeBytes,
  } = params;

  const hash = crypto.createHash(algorithm);

  const ranges: { start: number; end: number }[] = [];

  for (let start = 0; start < size; start += partSizeBytes) {
    const end = Math.min(start + partSizeBytes - 1, size - 1);
    ranges.push({ start, end });
  }

  await ranges.reduce<Promise<void>>(
    (p, { start, end }) =>
      p.then(async () => {
        const resp = await s3.getObject({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
        });

        return updateHashFromBody(hash, (resp as any).Body);
      }),
    Promise.resolve()
  );

  return hash.digest('hex');
};

const calculateGranuleFileChecksum = async (params: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;
  const { bucket, key, size } = granuleFile;

  const thresholdMb = Number(process.env.MULTIPART_CHECKSUM_THRESHOLD_MEGABYTES || 0);
  const partMb = Number(process.env.MULTIPART_CHECKSUM_PART_MEGABYTES || 0);
  const thresholdBytes = thresholdMb * 1024 * 1024;
  const partSizeBytes = partMb * 1024 * 1024;

  const partitioningEnabled = (thresholdMb > 0 && partMb > 0)
    && (size > thresholdBytes);

  // Calculate checksum by partitioning
  if (partitioningEnabled) {
    return await calculateObjectHashByRanges({
      s3,
      algorithm,
      bucket,
      key,
      size,
      partSizeBytes: partSizeBytes,
    });
  }

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

export const addChecksumToGranuleFile = async (params: {
  s3: { getObject: S3.GetObjectMethod },
  algorithm: string,
  granuleFile: GranuleFile
}) => {
  const { s3, algorithm, granuleFile } = params;

  if (skipGranuleFileUpdate(granuleFile)) {
    return granuleFile;
  }

  const checksum = await calculateGranuleFileChecksum({
    s3: s3,
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

  const s3Client = awsClients.s3();
  const granulesWithChecksums = await Promise.all(
    input.granules.map(
      (granule) => addFileChecksumsToGranule({
        s3: { getObject: (params: any) => S3.getObject(s3Client, params) },
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

export const cmaHandler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
) => await runCumulusTask(handler, event, context);

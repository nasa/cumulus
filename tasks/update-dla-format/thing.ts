// const Logger = require('@cumulus/logger');
import minimist from 'minimist';
import path from 'path';
import * as url from 'node:url';
import { getJsonS3Object, putJsonS3Object } from '@cumulus/aws-client/S3';
import { hoistCumulusMessageDetails } from '../../packages/message/DeadLetterMessage';

const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  targetPath: string,
  prefix: string
) => {
  const dlaObject = await getJsonS3Object(bucket, sourcePath + '/' + prefix);
  console.log(dlaObject);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  console.log(hoisted);
  console.log(bucket, targetPath, prefix, hoisted);
  return putJsonS3Object(bucket, targetPath + '/' + prefix, hoisted);
};

const verifyRequiredEnvironmentVariables = () => {
  [
    'DEPLOYMENT',
    'AWS_PROFILE',
    'INTERNAL_BUCKET',
  ].forEach((x) => {
    if (!process.env[x]) {
      throw new Error(`Environment variable "${x}" is not set.`);
    }
  });
};

const parsePath = (prefix: string | undefined): string => {
  const defaultPath = `${process.env['DEPLOYMENT']}/dead_letter_archive/sqs`;
  if (!prefix) {
    console.log(
      `no prefix arg given, defaulting path to ${defaultPath}`
    );
    return defaultPath;
  }
  return path.dirname(prefix);
};

const parseTargetPath = (targetPath: string | undefined, sourcePath: string): string => {
  if (!targetPath) {
    const defaultTarget = sourcePath + '_updated_dla';
    console.log(
      `no targetPath given, defaulting targetPath to ${defaultTarget}`
    );
    return defaultTarget;
  }
  if (targetPath === sourcePath) {
    console.log(
      'writing output to input bucket'
    );
  }
  return targetPath;
};

const parsePrefix = (prefix: string | undefined): string => (prefix ? path.basename(prefix) : '/');

const modulePath = url.fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
  verifyRequiredEnvironmentVariables();
  const internalBucket = process.env['INTERNAL_BUCKET'];
  if (!internalBucket) {
    throw new Error('a');
  }
  const args = minimist(
    process.argv,
    {
      string: ['prefix', 'targetPath'],
      alias: {
        p: 'prefix',
        key: 'prefix',
        k: 'prefix',
        path: 'prefix',
        target: 'targetPath',
      },
      default: {
        prefix: undefined,
        targetPath: undefined,
      },
    }
  );
  console.log(args);
  const sourcePath = parsePath(args.prefix);
  const targetPath = parseTargetPath(args.targetPath, sourcePath);
  const prefix = parsePrefix(args.prefix);
  console.log(sourcePath);
  console.log(targetPath);
  console.log(prefix);
  await updateDLAFile(internalBucket, sourcePath, targetPath, prefix);
}

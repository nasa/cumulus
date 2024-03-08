import { zip } from 'lodash';
import minimist from 'minimist';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3Objects,
  headObject,
} from '@cumulus/aws-client/S3';
import { hoistCumulusMessageDetails } from '../../packages/message/DeadLetterMessage';

const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  targetPath: string
) => {
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  return putJsonS3Object(bucket, targetPath, hoisted);
};

const updateDLABatch = async (
  bucket: string,
  sourceDirectory: string,
  targetDirectory: string,
  prefix: string
) => {
  const subObjects = await listS3Objects(bucket, path.join(sourceDirectory, prefix));
  const validKeys = subObjects.map(
    (obj) => obj.Key
  ).filter(
    (key) => key !== undefined
  ) as Array<string>;
  const sourcePaths = validKeys;
  const fileNames = validKeys.map((key) => path.basename(key));

  // const sourcePaths = fileNames.map((fileName) => path.join(sourceDirectory, fileName));
  const targetPaths = fileNames.map((fileName) => path.join(targetDirectory, fileName));
  const zipped: Array<[string, string]> = zip(sourcePaths, targetPaths) as Array<[string, string]>;
  zipped.forEach(
    (pathPair) => updateDLAFile(bucket, pathPair[0], pathPair[1])
  );
};
const getEnvironmentVariable = (variable: string): string => {
  if (!process.env[variable]) {
    throw new Error(`Environment variable "${variable}" is not set.`);
  }
  return process.env[variable] as string;
}
const verifyRequiredEnvironmentVariables = () => {
  [
    'DEPLOYMENT',
    'AWS_PROFILE',
    'INTERNAL_BUCKET',
  ].forEach((x) => {
    getEnvironmentVariable(x);
  });
};


const parseS3Directory = (prefix: string) => {
  const directoryForm = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const bucket = getEnvironmentVariable('INTERNAL_BUCKET');
  const testObjects = listS3Objects(bucket, prefix).then(
    (a) => a
  ).catch((error) => { throw error; });


  const testKey = testObjects.filter((obj) => obj.Key)[0].Key as string;
  if (testKey.startsWith(directoryForm)) {
    return prefix;
  }
  return path.dirname(prefix);
};

const parsePath = (prefix: string | undefined): string => {
  const defaultPath = `${process.env['DEPLOYMENT']}/dead_letter_archive/sqs/`;
  if (!prefix) {
    console.log(
      `no prefix arg given, defaulting path to ${defaultPath}`
    );
    return defaultPath;
  }
  return parseS3Directory(prefix)
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


if (require.main === module) {
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

  const s3Directory = parseS3Directory(prefix);
  console.log(checkShit);
  console.log(parsePath, parseTargetPath, parsePrefix);
  // const sourcePath = parsePath(args.prefix);
  // const targetPath = parseTargetPath(args.targetPath, sourcePath);
  // const prefix = parsePrefix(args.prefix);
  // console.log(sourcePath);
  // console.log(targetPath);
  // console.log(prefix);

  // updateDLABatch(
  //   internalBucket,
  //   sourcePath,
  //   targetPath,
  //   prefix
  // ).then(
  //   (ret) => console.log(ret)
  // ).catch((error) => {
  //   console.log(`update-dla-format failed: ${error}`);
  //   throw error;
  // });
  console.log(updateDLAFile);
  console.log(updateDLABatch)
}

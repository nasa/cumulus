import { zip } from 'lodash';
import minimist from 'minimist';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3Objects,
} from '@cumulus/aws-client/S3';
import { hoistCumulusMessageDetails } from '../../packages/message/DeadLetterMessage';
const getEnvironmentVariable = (variable: string): string => {
  if (!process.env[variable]) {
    throw new Error(`Environment variable "${variable}" is not set.`);
  }
  return process.env[variable] as string;
};

const verifyRequiredEnvironmentVariables = () => {
  [
    'DEPLOYMENT',
    'AWS_PROFILE',
    'INTERNAL_BUCKET',
  ].forEach((x) => {
    getEnvironmentVariable(x);
  });
};

const manipulateTrailingSlash = (str: string, shouldHave: boolean): string => {
  const has = str.endsWith('/');
  if (has && shouldHave) {
    return str;
  }
  if (!has && !shouldHave) {
    return str;
  }
  if (!has && shouldHave) {
    return `${str}/`;
  }
  if (has && !shouldHave) {
    return str.slice(0, -1);
  }
  throw new Error('how did you get here? this shouldnt be possible');
};
const parseS3Directory = async (prefix: string): Promise<string> => {
  const directoryForm = manipulateTrailingSlash(prefix, true);
  const bucket = getEnvironmentVariable('INTERNAL_BUCKET');
  const testObjects = await listS3Objects(bucket, prefix);
  try {
    const testKey = testObjects.filter((obj) => 'Key' in obj)[0].Key as string;
    if (testKey.startsWith(directoryForm)) {
      return directoryForm;
    }
  } catch (error) {
    throw new Error(`cannot find contents of bucket ${bucket} under key ${prefix}`);
  }

  return path.dirname(prefix);
};
const parsePrefix = (prefix: string | undefined): string => {
  const defaultPath = `${process.env['DEPLOYMENT']}/dead-letter-archive/sqs/`;
  if (!prefix) {
    console.log(
      `no prefix arg given, defaulting path to ${defaultPath}`
    );
    return defaultPath;
  }
  return prefix;
};

const parsePath = async (prefix: string | undefined): Promise<string> => (
  await parseS3Directory(parsePrefix(prefix))
);

const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  targetPath: string
) => {
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  return await putJsonS3Object(bucket, targetPath, hoisted);
};

const updateDLABatch = async (
  bucket: string,
  targetDirectory: string,
  prefix: string
) => {
  const sourceDir = await parsePath(prefix);
  const subObjects = await listS3Objects(bucket, prefix);

  const validKeys = subObjects.map(
    (obj) => obj.Key
  ).filter(
    (key) => key !== undefined
  ) as Array<string>;
  const targetPaths = validKeys.map((filePath) => filePath.replace(sourceDir, targetDirectory));

  const zipped: Array<[string, string]> = zip(validKeys, targetPaths) as Array<[string, string]>;
  zipped.forEach((pathPair) => updateDLAFile(bucket, pathPair[0], pathPair[1]));
};



const parseTargetPath = async (
  targetPath: string | undefined,
  prefix: string | undefined
): Promise<string> => {
  const sourceDir = await parsePath(prefix);
  if (!targetPath) {
    const defaultTarget = `${manipulateTrailingSlash(sourceDir, false)}_updated_dla/`;
    console.log(
      `no targetPath given, defaulting targetPath to ${defaultTarget}`
    );
    return defaultTarget;
  }
  const targetDir = manipulateTrailingSlash(targetPath, true);
  if (targetDir === sourceDir) {
    console.log(
      'writing output to input bucket'
    );
  }
  return targetDir;
};

const main = async () => {
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

  const targetDir = await parseTargetPath(args.targetPath, args.prefix);
  const prefix = await parsePrefix(args.prefix);

  updateDLABatch(internalBucket, targetDir, prefix);

};

if (require.main === module) {
  main(
  ).then(
    (ret) => console.log(ret)
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}

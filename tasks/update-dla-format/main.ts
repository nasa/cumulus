import { zip } from 'lodash';
import minimist from 'minimist';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3Objects,
} from '@cumulus/aws-client/S3';
import {
  PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { hoistCumulusMessageDetails } from '@cumulus/message/DeadLetterMessage';
const getEnvironmentVariable = (variable: string): string => {
  if (!process.env[variable]) {
    throw new Error(`Environment variable "${variable}" is not set.`);
  }
  return process.env[variable] as string;
};

const verifyRequiredEnvironmentVariables = () => {
  [
    'DEPLOYMENT',
    'INTERNAL_BUCKET',
  ].forEach((x) => {
    getEnvironmentVariable(x);
  });
};

export const manipulateTrailingSlash = (str: string, shouldHave: boolean): string => {
  if (str === '') {
    return str;
  }
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
    let out = str.slice(0, -1);
    while (out.endsWith('/')) {
      out = out.slice(0, -1);
    }
    return out;
  }
  throw new Error('how did you get here? this shouldnt be possible');
};
export const parseS3Directory = async (prefix: string): Promise<string> => {
  let prefixForm = prefix;
  /* expect user might point us at '/' expecting that to mean 'everything' */
  if (prefixForm === '/') {
    prefixForm = '';
  }
  const directoryForm = manipulateTrailingSlash(prefixForm, true);
  const bucket = getEnvironmentVariable('INTERNAL_BUCKET');

  let prefixIsValid = false;
  let directoryIsValid = false;
  let keys = [];
  try {
    const testObjects = await listS3Objects(bucket, prefixForm);
    keys = testObjects.map((obj) => obj.Key);
    if (keys.length === 0) {
      throw new Error(`cannot find contents of bucket ${bucket} under prefix '${prefixForm}'`);
    }
  } catch (error) {
    throw new Error(`cannot find contents of bucket ${bucket} under prefix '${prefixForm}'`);
  }

  keys.forEach((key) => {
    if (key && key.startsWith(directoryForm)) {
      directoryIsValid = true;
    } else if (key && key.startsWith(prefixForm)) {
      prefixIsValid = true;
    }
  });
  if (prefixIsValid) {
    let dirname = path.dirname(prefixForm);
    if (dirname === '.') {
      dirname = '';
    }
    return manipulateTrailingSlash(dirname, true);
  }
  if (directoryIsValid) {
    return directoryForm;
  }
  
  throw new Error(`cannot find contents of bucket ${bucket} under prefix ${prefix}`);
};

export const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  targetPath: string
): Promise<PutObjectCommandOutput> => {
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  return await putJsonS3Object(bucket, targetPath, hoisted);
};

export const updateDLABatch = async (
  bucket: string,
  targetDirectory: string,
  prefix: string
) => {
  const sourceDir = await parseS3Directory(prefix);
  const subObjects = await listS3Objects(bucket, prefix);

  const validKeys = subObjects.map(
    (obj) => obj.Key
  );
  const targetPaths = validKeys.map(
    (filePath) => filePath.replace(
      sourceDir,
      manipulateTrailingSlash(targetDirectory, true)
    )
  );

  const zipped: Array<[string, string]> = zip(validKeys, targetPaths) as Array<[string, string]>;
  await Promise.all(zipped.map((pathPair) => updateDLAFile(bucket, pathPair[0], pathPair[1])));
};

const parseTargetPath = async (
  targetPath: string,
  prefix: string
): Promise<string> => {
  const sourceDir = await parseS3Directory(prefix);
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

  const internalBucket = getEnvironmentVariable('INTERNAL_BUCKET');
  const deployment = getEnvironmentVariable('DEPLOYMENT');
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
  const prefix = args.prefix || `${deployment}/dead-letter-archive/sqs/`;
  const targetDir = await parseTargetPath(args.targetPath, args.prefix);

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

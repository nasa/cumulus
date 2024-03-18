import zip from 'lodash/zip';
import minimist from 'minimist';
import path from 'path';
import {
  getJsonS3Object,
  putJsonS3Object,
  listS3Objects,
  s3ObjectExists,
} from '@cumulus/aws-client/S3';
import { hoistCumulusMessageDetails } from '@cumulus/message/DeadLetterMessage';

/**
 * Check for an Env variable and throw if it's not present
 */
export const getEnvironmentVariable = (variable: string): string => {
  if (!process.env[variable]) {
    throw new Error(`Environment variable "${variable}" is not set.`);
  }
  return process.env[variable] as string;
};

/**
 * Ensure that a string has or does not have a trailing slash as appropriate
 * the strings '' and '/' are special cases that should return '' always
 * because we're handling 'directories' in S3, expect a user to give '/' and mean 'the whole bucket'
 * @param S3Path a string meant to represent a path within an S3 bucket
 * @param shouldHave should it end with a '/'
 * @returns massaged S3Path
 */
export const manipulateTrailingSlash = (S3Path: string, shouldHave: boolean): string => {
  if (S3Path === '' || S3Path === '/') {
    return '';
  }
  const has = S3Path.endsWith('/');
  if (has && shouldHave) {
    return S3Path;
  }
  if (!has && !shouldHave) {
    return S3Path;
  }
  if (!has && shouldHave) {
    return `${S3Path}/`;
  }
  if (has && !shouldHave) {
    let out = S3Path.slice(0, -1);
    while (out.endsWith('/')) {
      out = out.slice(0, -1);
    }
    return out;
  }
  /* this is just to satisfy typescript, it shouldn't be possible to get here */
  return S3Path;
};

/**
 * Parse the S3 'directory' referenced by a prefix.
 * @param prefix
 * @returns
 *  - '' if prefix is '' or '/'
 *  - parent directory to prefix if prefix doesn't refer to a directory itself
 *  - prefix in 'directory' form (trailing slash) if it refers to a directory
 */
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
      throw new Error(`cannot find contents of bucket ${bucket} under prefix "${prefixForm}"`);
    }
  } catch (error) {
    throw new Error(`cannot find contents of bucket ${bucket} under prefix "${prefixForm}"`);
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
  throw new Error(`Couldn't make sense of contents of bucket ${bucket} under prefix "${prefixForm}"`);
};

/**
 * handle given targetPath, either parsing standard from prefix if targetPath is undefined
 * or massaging targetPath into a 'Directory' if a
 * @param targetPath given target to parse or undefined if none given
 * @param prefix only relevant if targetPath is unspecified
 * @returns Promise<string>
 */
export const parseTargetPath = async (
  targetPath: string | undefined,
  prefix: string
): Promise<string> => {
  if (targetPath !== undefined) {
    return manipulateTrailingSlash(targetPath, true);
  }
  const sourceDir = await parseS3Directory(prefix);
  const defaultTarget = `${manipulateTrailingSlash(sourceDir, false)}_updated_dla/`;
  console.log(
    `no targetPath given, defaulting targetPath to ${defaultTarget}`
  );
  return defaultTarget;
};

/**
 * pull S3 Object from sourcePath, update it to new DLA structure and push it to targetPath
 * noop if skip is true and an object already exists at targetPath
 * @param bucket
 * @param sourcePath
 * @param targetPath
 * @param skip skip if targetPath already exists
 * @returns whether the logic was actually run (not skipped)
 */
export const updateDLAFile = async (
  bucket: string,
  sourcePath: string,
  targetPath: string,
  skip: boolean = false
): Promise<boolean> => {
  if (skip && await s3ObjectExists({ Bucket: bucket, Key: targetPath })) {
    return false;
  }
  const dlaObject = await getJsonS3Object(bucket, sourcePath);
  const hoisted = await hoistCumulusMessageDetails(dlaObject);
  await putJsonS3Object(bucket, targetPath, hoisted);
  return true;
};

/**
 * update a batch of DLA files under prefix and push them to the targetDirectory
 * skip files that appear to already have been processed if skip is set to true
 * @param bucket
 * @param targetDirectory
 * @param prefix
 * @param skip skip files that are already present at the target directory, default false
 */
export const updateDLABatch = async (
  bucket: string,
  targetDirectory: string,
  prefix: string,
  skip: boolean = false
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
  return await Promise.all(
    zipped.map((pathPair) => updateDLAFile(
      bucket, pathPair[0], pathPair[1], skip
    ))
  );
};

interface UpdateDLAArgs {
  prefix: string,
  targetPath: string,
  skip: boolean,
}

export const processArgs = async (): Promise<UpdateDLAArgs> => {
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
        'skip-existing': 'skip',
      },
      default: {
        prefix: undefined,
        targetPath: undefined,
        skip: false,
      },
    }
  );
  const prefix = args.prefix || `${getEnvironmentVariable('DEPLOYMENT')}/dead-letter-archive/sqs/`;
  return {
    prefix,
    skip: args.skip,
    targetPath: await parseTargetPath(args.targetPath, prefix),
  };
};

/**
 * Main function to update dla structure
 * expects environment variable INTERNAL_BUCKET
 * expects environment variable DEPLOYMENT *if* prefix is not specified (for parsing the default)
 * parses args to get prefix, targetPath and skip
 * massages args for useability
 * pulls all files from the INTERNAL_BUCKET beneath the given prefix
 * massages them to the updated DLA format
 * pushes them to the targetPath with a similar directory structure
 */
const main = async () => {
  const internalBucket = getEnvironmentVariable('INTERNAL_BUCKET');
  const {
    targetPath,
    prefix,
    skip,
  } = await processArgs();

  await updateDLABatch(internalBucket, targetPath, prefix, skip);
};

if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}

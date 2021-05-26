import AWS from 'aws-sdk';
import got from 'got';
import Logger from '@cumulus/logger';
import { Context } from 'aws-lambda';

import { constructCollectionId } from '@cumulus/message/Collections';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { getCollection } from '@cumulus/api-client/collections';
import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { getSecretString } from '@cumulus/aws-client/SecretsManager';
import { inTestMode } from '@cumulus/aws-client/test-utils';
import { parseS3Uri } from '@cumulus/aws-client/S3';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import { s3 as coreS3, sts } from '@cumulus/aws-client/services';
import {
  constructDistributionUrl,
  fetchDistributionBucketMap,
} from '@cumulus/distribution-utils';

import {
  ChecksumError,
  CollectionNotDefinedError,
  CollectionInvalidRegexpError,
  GetAuthTokenError,
  InvalidUrlTypeError,
} from './errors';
import { isFulfilledPromise } from './typeGuards';
import { makeBackupFileRequestResult, HandlerEvent, MessageGranule, MessageGranuleFilesObject } from './types';

const log = new Logger({ sender: '@cumulus/lzards-backup' });

const CREDS_EXPIRY_SECONDS = 1000;
const S3_LINK_EXPIRY_SECONDS_DEFAULT = 3600;

export const generateDistributionUrl = async (params: {
  Bucket: string,
  Key: string,
  distributionEndpoint?: string,
}) => {
  console.log('hereL1');
  const distributionBucketMap = await fetchDistributionBucketMap();
  console.log('hereL2');
  return constructDistributionUrl(
    params.Bucket,
    params.Key,
    distributionBucketMap,
    (params.distributionEndpoint || '')
  );
};

export const generateDirectS3Url = async (params: {
  roleCreds: AWS.STS.AssumeRoleResponse,
  Bucket: string,
  Key: string,
  usePassedCredentials?: boolean
}) => {
  console.log('hereK1');
  const { roleCreds, Key, Bucket, usePassedCredentials } = params;
  const region = process.env.AWS_REGION || 'us-east-1';
  const secretAccessKey = roleCreds?.Credentials?.SecretAccessKey;
  const sessionToken = roleCreds?.Credentials?.SessionToken;
  const accessKeyId = roleCreds?.Credentials?.AccessKeyId;
  console.log('hereK2');
  const s3AccessTimeoutSeconds = (
    process.env.lzards_s3_link_timeout || S3_LINK_EXPIRY_SECONDS_DEFAULT
  );
  let s3;
  console.log('hereK3');
  if (!inTestMode() || usePassedCredentials) {
    console.log('hereK4');
    const s3Config = {
      signatureVersion: 'v4',
      secretAccessKey,
      accessKeyId,
      sessionToken,
      region,
    };
    s3 = new AWS.S3(s3Config);
  } else {
    console.log('hereK5');
    coreS3().config.update({ signatureVersion: 'v4' });
    s3 = coreS3();
  }
  return await s3.getSignedUrlPromise('getObject', { Bucket, Key, Expires: s3AccessTimeoutSeconds });
};

export const generateAccessUrl = async (params: {
  Bucket: string,
  Key: string,
  urlConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    urlType?: string,
    distributionEndpoint?: string,
  },
}) => {
  console.log('hereJ1');
  const {
    Bucket,
    Key,
    urlConfig: {
      roleCreds,
      urlType,
      distributionEndpoint,
    },
  } = params;
  console.log('hereJ2');
  try {
    switch ((urlType || 's3')) {
      case 's3': return await generateDirectS3Url({ roleCreds, Bucket, Key });
      case 'distribution': return await generateDistributionUrl({ Bucket, Key, distributionEndpoint });
      default: throw new InvalidUrlTypeError(`${urlType} is not a recognized type for access URL generation`);
    }
  } catch (error) {
    console.log('hereJ3');
    log.error(`${urlType} access URL generation failed for s3://${Bucket}/${Key}: ${error}`);
    throw error;
  }
};

export const setLzardsChecksumQueryType = (
  file: MessageGranuleFilesObject,
  granuleId: string
) => {
  console.log('hereI1');
  if (file.checksumType === 'md5') {
    return { expectedMd5Hash: file.checksum };
  }
  if (file.checksumType === 'sha256') {
    return { expectedSha256Hash: file.checksum };
  }
  log.error(`${granuleId}: File ${file.filename} did not have a checksum or supported checksumType defined`);
  throw new ChecksumError(`${granuleId}: File ${file.filename} did not have a checksum or checksumType defined`);
};

export const postRequestToLzards = async (params: {
  accessUrl: string,
  authToken: string,
  collection: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
}) => {
  console.log('hereH1');
  const {
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  } = params;

  const provider = getRequiredEnvVar('lzards_provider');
  const lzardsApiUrl = getRequiredEnvVar('lzards_api');
  console.log('hereH2');
  const checksumConfig = setLzardsChecksumQueryType(file, granuleId);
  console.log('hereH3');
  return await got.post(lzardsApiUrl,
    {
      json: {
        provider,
        objectUrl: accessUrl,
        metadata: {
          filename: file.filename,
          collection,
          granuleId,
        },
        ...checksumConfig,
      },
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
};

export const makeBackupFileRequest = async (params: {
  backupConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    authToken: string,
    urlType: string,
    distributionEndpoint?: string,
  },
  collectionId: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
  lzardsPostMethod?: typeof postRequestToLzards,
  generateAccessUrlMethod?: typeof generateAccessUrl,
}): Promise<makeBackupFileRequestResult> => {
  console.log('hereG1');
  const {
    collectionId,
    backupConfig,
    backupConfig: { authToken },
    file,
    granuleId,
    lzardsPostMethod = postRequestToLzards,
    generateAccessUrlMethod = generateAccessUrl,
  } = params;
  console.log('hereG2');
  try {
    const { Key, Bucket } = parseS3Uri(file.filename);
    log.info(`${granuleId}: posting backup request to LZARDS: ${file.filename}`);
    console.log('hereG3');
    const accessUrl = await generateAccessUrlMethod({
      Bucket,
      Key,
      urlConfig: backupConfig,
    });
    console.log('hereG4');
    const { statusCode, body } = await lzardsPostMethod({
      accessUrl,
      authToken,
      collection: collectionId,
      file,
      granuleId,
    });
    console.log('hereG5');
    if (statusCode !== 201) {
      log.error(`${granuleId}: Request failed - LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
      return { statusCode, granuleId, filename: file.filename, body, status: 'FAILED' };
    }
    console.log('hereG6');
    return { statusCode, granuleId, filename: file.filename, body, status: 'COMPLETED' };
  } catch (error) {
    console.log('hereG7');
    log.error(`${granuleId}: LZARDS request failed: ${error}, response: ${JSON.stringify(error.response)}`);
    return {
      granuleId,
      filename: file.filename,
      body: JSON.stringify({ name: error.name, stack: error.stack }),
      status: 'FAILED',
    };
  }
};

export const shouldBackupFile = (
  fileName: string,
  collectionConfig: CollectionRecord
): boolean => {
  console.log('hereF1');
  const collectionFiles = collectionConfig?.files || [];
  const matchingConfig = collectionFiles.filter(
    ({ regex }) => fileName.match(regex)
  );
  console.log('hereF2');
  if (matchingConfig.length > 1) {
    const errString = `Multiple files matched configured regexp for ${JSON.stringify(collectionConfig)},${fileName}`;
    log.error(errString);
    throw new CollectionInvalidRegexpError(errString);
  }
  console.log('hereF3');
  if (matchingConfig[0]?.lzards?.backup) return true;
  console.log('hereF4');
  return false;
};

export const getGranuleCollection = async (params: {
  collectionName: string,
  collectionVersion: string,
  stackPrefix?: string
}): Promise<CollectionRecord> => {
  console.log('hereE1');
  const prefix = params.stackPrefix || getRequiredEnvVar('stackName');
  const { collectionName, collectionVersion } = params;
  console.log('hereE2');
  if (!collectionName && !collectionVersion) {
    throw new CollectionNotDefinedError('Collection Name and Version not defined');
  }
  console.log('hereE3');
  return await getCollection({
    prefix,
    collectionName,
    collectionVersion,
  });
};

export const backupGranule = async (params: {
  granule: MessageGranule,
  backupConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    authToken: string,
    urlType: string,
    distributionEndpoint?: string,
  },
}) => {
  console.log('hereD1');
  const { granule, backupConfig } = params;
  log.info(`${granule.granuleId}: Backup called on granule: ${JSON.stringify(granule)}`);
  console.log('hereD2');
  try {
    const granuleCollection = await getGranuleCollection({
      collectionName: granule.dataType,
      collectionVersion: granule.version,
    });
    console.log('hereD3');
    const collectionId = constructCollectionId(granule.dataType, granule.version);
    console.log('hereD4');
    const backupFiles = granule.files.filter(
      (file) => shouldBackupFile(file.name, granuleCollection)
    );
    console.log('hereD5');
    log.info(`${JSON.stringify(granule)}: Backing up ${JSON.stringify(backupFiles)}`);
    console.log('hereD6');
    return Promise.all(backupFiles.map((file) => makeBackupFileRequest({
      backupConfig,
      file,
      collectionId,
      granuleId: granule.granuleId,
    })));
  } catch (error) {
    console.log('hereD7');
    if (error.name === 'CollectionNotDefinedError') {
      log.error(`${granule.granuleId}: Granule did not have a properly defined collection and version, or refer to a collection that does not exist in the database`);
      log.error(`${granule.granuleId}: Granule (${granule.granuleId}) will not be backed up.`);
    }
    console.log('hereD8');
    error.message = `${granule.granuleId}: ${error.message}`;
    throw error;
  }
};

export const generateAccessCredentials = async () => {
  console.log('hereC1');
  const params = {
    RoleArn: getRequiredEnvVar('backup_role_arn'),
    DurationSeconds: CREDS_EXPIRY_SECONDS,
    RoleSessionName: `${Date.now()}`,
  };
  console.log('hereC2');
  const roleCreds = await sts().assumeRole(params).promise();
  console.log('hereC3');
  return roleCreds as AWS.STS.AssumeRoleResponse;
};

export const getAuthToken = async () => {
  console.log('hereB1');
  const api = getRequiredEnvVar('launchpad_api');
  console.log('hereB2');
  const passphrase = await getSecretString(getRequiredEnvVar('launchpad_passphrase_secret_name'));
  console.log('hereB3');
  if (!passphrase) {
    throw new GetAuthTokenError('The value stored in "launchpad_passphrase_secret_name" must be defined');
  }
  console.log('hereB4');
  const certificate = getRequiredEnvVar('launchpad_certificate');
  console.log('hereB5');
  const token = await getLaunchpadToken({
    api, passphrase, certificate,
  });
  console.log('hereB6');
  return token;
};

export const backupGranulesToLzards = async (event: HandlerEvent) => {
  console.log('hereA1');
  // Given an array of granules, submit each file for backup.
  log.warn(`Running backup on ${JSON.stringify(event)}`);
  const roleCreds = await generateAccessCredentials();
  const authToken = await getAuthToken();
  console.log('hereA2');
  const backupConfig = {
    ...event.config,
    roleCreds,
    authToken,
  };
  console.log('hereA3');
  const backupPromises = (event.input.granules.map(
    (granule) => backupGranule({ granule, backupConfig })
  ));
  console.log('hereA4');
  const backupResults = await Promise.allSettled(backupPromises);
  console.log('hereA5');
  // If there are uncaught exceptions, we want to fail the task.
  if (backupResults.some((result) => result.status === 'rejected')) {
    log.error('Some LZARDS backup results failed due to internal failure');
    log.error('Manual reconciliation required - some backup requests may have processed');
    log.error(`Full output: ${JSON.stringify(backupResults)}`);
    throw new Error(`${JSON.stringify(backupResults)}`);
  }
  console.log('hereA6');
  const filteredResults = backupResults.filter(
    (result) => isFulfilledPromise(result)
  ) as PromiseFulfilledResult<makeBackupFileRequestResult[]>[];
  console.log('hereA7');
  return {
    backupResults: filteredResults.map((result) => result.value).flat(),
    granules: event.input.granules,
  };
};

export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(backupGranulesToLzards, event, context);

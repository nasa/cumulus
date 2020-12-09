import AWS from 'aws-sdk';
import got from 'got';
import Logger from '@cumulus/logger';
import { Context } from 'aws-lambda';

import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { getCollections } from '@cumulus/api-client/collections';
import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { getSecretString } from '@cumulus/aws-client/SecretsManager';
import { inTestMode } from '@cumulus/aws-client/test-utils';
import { parseS3Uri } from '@cumulus/aws-client/S3';
import { PartialCollectionRecord } from '@cumulus/types/api/collections';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import { s3 as coreS3, sts } from '@cumulus/aws-client/services';

import { ChecksumError, CollectionError, GetAuthTokenError } from './errors';
import { isFulfilledPromise } from './typeGuards';
import { makeBackupFileRequestResult, HandlerEvent, MessageGranule, MessageGranuleFilesObject } from './types';

const log = new Logger({ sender: '@cumulus/lzards-backup' });

const CREDS_EXPIRY_SECONDS = 3600;

export const generateAccessUrl = async (params: {
  creds: AWS.STS.AssumeRoleResponse,
  Key: string,
  Bucket: string
  usePassedCredentials?: boolean
}) => {
  const { creds, Key, Bucket, usePassedCredentials } = params;
  const region = process.env.region_name || 'us-east-1';
  const secretAccessKey = creds?.Credentials?.SecretAccessKey;
  const sessionToken = creds?.Credentials?.SessionToken;
  const accessKeyId = creds?.Credentials?.AccessKeyId;

  const s3Config = {
    signatureVersion: 'v4',
    secretAccessKey,
    accessKeyId,
    sessionToken,
    region,
  };

  let s3;
  if (!inTestMode() || usePassedCredentials) {
    s3 = new AWS.S3(s3Config);
  } else {
    coreS3().config.update({ signatureVersion: 'v4' });
    s3 = coreS3();
  }
  return s3.getSignedUrlPromise('getObject', { Bucket, Key, Expires: CREDS_EXPIRY_SECONDS });
};

export const setLzardsChecksumQueryType = (
  file: MessageGranuleFilesObject,
  granuleId: string
) => {
  if (file.checksumType === 'md5') {
    return { expectedMd5Hash: file.checksum };
  }
  if (file.checksumType === 'sha256') {
    return { expectedSha256Hash: file.checksum };
  }
  log.error(`${granuleId}: File ${file.name} did not have a checksum or supported checksumType defined`);
  throw new ChecksumError(`${granuleId}: File ${file.name} did not have a checksum or checksumType defined`);
};

export const postRequestToLzards = async (params: {
  accessUrl: string,
  authToken: string,
  collection: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
}) => {
  const {
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  } = params;

  const provider = getRequiredEnvVar('provider');
  const lzardsApiUrl = getRequiredEnvVar('lzards_api');

  const checksumConfig = setLzardsChecksumQueryType(file, granuleId);

  return got.post(lzardsApiUrl,
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
        'Content-Type': 'application/json',
      },
    });
};

export const makeBackupFileRequest = async (params: {
  authToken: string,
  collection: string,
  creds: AWS.STS.AssumeRoleResponse,
  file: MessageGranuleFilesObject,
  granuleId: string,
  lzardsPostMethod?: typeof postRequestToLzards,
  generateAccessUrlMethod?: typeof generateAccessUrl,
}): Promise<makeBackupFileRequestResult> => {
  const {
    authToken,
    collection,
    creds,
    file,
    granuleId,
    lzardsPostMethod = postRequestToLzards,
    generateAccessUrlMethod = generateAccessUrl,
  } = params;

  const { Key, Bucket } = parseS3Uri(file.filename);

  const accessUrl = await generateAccessUrlMethod({
    Bucket,
    creds,
    Key,
  });
  log.info(`${granuleId}: posting backup request to LZARDS: ${file.filename}`);
  try {
    const { statusCode, body } = await lzardsPostMethod({
      accessUrl,
      authToken,
      collection,
      file,
      granuleId,
    });
    if (statusCode !== 201) {
      log.error(`${granuleId}: Request failed - LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
      return { statusCode, granuleId, filename: file.filename, body, status: 'FAILED' };
    }
    return { statusCode, granuleId, filename: file.filename, body, status: 'COMPLETED' };
  } catch (error) {
    log.error(`${granuleId}: LZARDS request failed: ${error}`);
    return { granuleId, filename: file.filename, status: 'FAILED' };
  }
};

export const shouldBackupFile = (
  fileName: string,
  collectionConfig: PartialCollectionRecord
): boolean => {
  const collectionFiles = collectionConfig?.files || [];
  const config = collectionFiles.find(
    ({ regex }) => fileName.match(regex)
  );
  if (config?.lzards?.backup) return true;
  return false;
};

export const getGranuleCollection = async (params: {
  collectionName: string,
  collectionVersion: string,
  stackPrefix?: string
}): Promise<PartialCollectionRecord> => {
  const prefix = params.stackPrefix || getRequiredEnvVar('stackName');
  const { collectionName, collectionVersion } = params;
  if (!collectionName && !collectionVersion) {
    throw new CollectionError('Collection Name and Version not defined');
  }
  const collectionResults = await getCollections({
    prefix,
    query: { name: collectionName, version: collectionVersion },
  });
  return JSON.parse(collectionResults.body).results[0] as PartialCollectionRecord;
};

export const backupGranule = async (
  creds: AWS.STS.AssumeRoleResponse,
  authToken: string,
  granule: MessageGranule
) => {
  log.info(`${granule.granuleId}: Backup called on granule: ${JSON.stringify(granule)}`);
  let granuleCollection: PartialCollectionRecord;
  try {
    granuleCollection = await getGranuleCollection({
      collectionName: granule.dataType,
      collectionVersion: granule.version,
    });
  } catch (error) {
    if (error.name === 'CollectionNotDefinedError') {
      log.error(`${granule.granuleId}: Granule did not have a properly defined collection and version, or refer to a collection that does not exist in the database`);
      log.error(`${granule.granuleId}: Granule (${granule.granuleId}) will not be backed up.`);
      error.message = `${granule.granuleId}: ${error.message}`;
      throw error;
    }
  }

  try {
    const backupFiles = granule.files.filter(
      (file) => shouldBackupFile(file.name, granuleCollection)
    );
    log.info(`${JSON.stringify(granule)}: Backing up ${JSON.stringify(backupFiles)}`);
    return Promise.all(backupFiles.map((file) => makeBackupFileRequest({
      creds,
      authToken,
      file,
      collection: `${granule.dataType}___${granule.version}`,
      granuleId: granule.granuleId,
    })));
  } catch (error) {
    error.message = `${granule.granuleId}: ${error.message}`;
    throw error;
  }
};

export const generateAccessCredentials = async () => {
  const params = {
    RoleArn: getRequiredEnvVar('backup_role_arn'),
    DurationSeconds: CREDS_EXPIRY_SECONDS,
    RoleSessionName: `${Date.now()}`,
  };
  const roleCreds = await sts().assumeRole(params).promise();
  return roleCreds as AWS.STS.AssumeRoleResponse;
};

export const getAuthToken = async () => {
  const api = getRequiredEnvVar('launchpad_api');
  const passphrase = await getSecretString(getRequiredEnvVar('launchpad_passphrase_secret_name'));
  if (!passphrase) {
    throw new GetAuthTokenError('The value stored in "launchpad_passphrase_secret_name" must be defined');
  }
  const certificate = getRequiredEnvVar('launchpad_certificate');
  const token = await getLaunchpadToken({
    api, passphrase, certificate,
  });
  return token;
};

export const backupGranulesToLzards = async (event: HandlerEvent) => {
  // Given an array of granules, submit each file for backup.
  log.warn(`Running backup on ${JSON.stringify(event)}`);
  const roleCreds = await generateAccessCredentials();
  const authToken = await getAuthToken() as string;

  const backupPromises = (event.input.granules.map(
    (granule) => backupGranule(roleCreds, authToken, granule)
  ));

  const backupResults = await Promise.allSettled(backupPromises);

  // If there are uncaught exceptions, we want to fail the task.
  if (backupResults.some((result) => result.status === 'rejected')) {
    log.error('Some LZARDS backup results failed due to internal failure');
    log.error('Manual reconciliation required - some backup requests may have processed');
    log.error(`Full output: ${JSON.stringify(backupResults)}`);
    throw new Error(`${JSON.stringify(backupResults)}`);
  }
  const filteredResults = backupResults.filter(
    (result) => isFulfilledPromise(result)
  ) as PromiseFulfilledResult<makeBackupFileRequestResult[]>[];
  return {
    backupResults: filteredResults.map((result) => result.value).flat(),
    originalPayload: event.input,
  };
};

export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => runCumulusTask(backupGranulesToLzards, event, context);

import AWS from 'aws-sdk';
import got from 'got';
import Logger from '@cumulus/logger';

import { getSecretString } from '@cumulus/aws-client/SecretsManager';
import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { PartialCollectionRecord } from '@cumulus/types/api/collections';
import { inTestMode } from '@cumulus/aws-client/test-utils';
import { s3 as coreS3 } from '@cumulus/aws-client/services';
import { getCollections } from '@cumulus/api-client/collections';
import { getRequiredEnvVar } from '@cumulus/common/env';

import { HandlerEvent, MessageGranule, MessageGranuleFilesObject } from './types';

const log = new Logger({ sender: '@cumulus/lzards-backup' });

export const generateAccessUrl = async (params: {
  creds: AWS.STS.AssumeRoleResponse,
  Key: string,
  Bucket: string
  usePassedCredentials?: boolean
}) => {
  const { creds, Key, Bucket, usePassedCredentials } = params;
  const region = process?.env?.region_name || 'us-east-1';
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
  return s3.getSignedUrlPromise('getObject', { Bucket, Key, Expires: 3600 });
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

  return got.post(lzardsApiUrl,
    {
      json: {
        provider,
        objectUrl: accessUrl,
        expectedMd5Hash: file.checksum,
        metadata: {
          filename: file.filename,
          collection,
          granuleId,
        },
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
  granuleId: string
}) => {
  const { authToken, collection, creds, file, granuleId } = params;
  const accessUrl = await generateAccessUrl({
    creds,
    Key: file.filepath,
    Bucket: file.bucket,
  });
  // TODO - support both checksums, trap errors
  const { statusCode, body } = await postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  });
  if (statusCode !== 201) {
    log.error(`${granuleId}:: LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
  }
  return { statusCode, granuleId, filename: file.name, body };
};

export const shouldBackupFile = (
  fileName: string,
  collectionConfig: PartialCollectionRecord
): boolean => {
  const collectionFiles = collectionConfig?.files || [];
  const config = collectionFiles.find(
    ({ regex }) => fileName.match(regex)
  );
  if (config?.backup) return true;
  return false;
};

export const getGranuleCollection = async (params: {
  collectionName: string,
  collectionVersion: string,
  stackPrefix?: string
}): Promise<PartialCollectionRecord> => {
  const prefix = params.stackPrefix || getRequiredEnvVar('stackName');
  const { collectionName, collectionVersion } = params;
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
  log.info(`Backup called on granule: ${JSON.stringify(granule)}`);
  const granuleCollection = await getGranuleCollection({
    collectionName: granule.dataType,
    collectionVersion: granule.version,
  });
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
};

export const generateAccessCredentials = async () => {
  const sts = new AWS.STS({ region: process.env.REGION });
  const params = {
    RoleArn: getRequiredEnvVar('backup_role_arn'),
    DurationSeconds: 900,
    RoleSessionName: `${Date.now()}`,
  };
  return sts.assumeRole(params).promise();
};

export const getAuthToken = async () => {
  const api = process.env.launchpad_api || '';
  const passphrase = await getSecretString(process?.env?.launchpad_passphrase_secret_name || '') || '';
  const certificate = process.env.launchpad_certificate || '';
  const token = await getLaunchpadToken({
    api, passphrase, certificate,
  });
  return token;
};

export const handler = async (event: HandlerEvent) => {
  // TODO check env var
  // Given an array of granules, submit each file for backup.
  // Use default collection if none specified?   Probably not.
  // Assume granule files have checksums
  const roleCreds = await generateAccessCredentials();
  const authToken = await getAuthToken() as string;

  const backupPromises = (event.input.granules.map(
    (granule) => backupGranule(roleCreds, authToken, granule)
  ));

  const backupResults = await Promise.all(backupPromises);
  return backupResults.flat();
};

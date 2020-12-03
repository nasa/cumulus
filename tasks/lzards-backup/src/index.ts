import AWS from 'aws-sdk';
import got from 'got';

import { getSecretString } from '@cumulus/aws-client/SecretsManager';
import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { HandlerEvent, MessageGranule, MessageGranuleFilesObject } from './types';

export const generateAccessUrl = async (
  creds: AWS.STS.AssumeRoleResponse,
  Key: string,
  Bucket: string
) => {
  const region = process?.env?.region_name || 'us-east-1';
  const secretAccessKey = creds.Credentials?.SecretAccessKey || '';
  const sessionToken = creds.Credentials?.SessionToken;
  const accessKeyId = creds.Credentials?.AccessKeyId;
  const s3 = new AWS.S3({
    signatureVersion: 'v4',
    secretAccessKey,
    accessKeyId,
    sessionToken,
    region,
  });
  return s3.getSignedUrlPromise('getObject', { Bucket, Key, Expires: 8600 });
};

export const getS3HostName = (bucketName: string): string => {
  const region = process?.env?.region_name || 'us-east-1';
  const regionString = region === 'us-east-1' ? '' : `.${region}`;
  return `${bucketName}.s3${regionString}.amazonaws.com`;
};

export const makeBackupFileRequest = async (
  creds: AWS.STS.AssumeRoleResponse,
  authToken: string,
  file: MessageGranuleFilesObject,
  collection: string,
  granuleId: string
) => {
  const accessUrl = await generateAccessUrl(creds, file.filepath, file.bucket);
  // TODO check env vars
  const lzardsApiUrl = process.env.lzards_api as string;
  // TODO - support both checksums, trap errors

  const { statusCode, body } = await got.post(lzardsApiUrl,
    {
      json: {
        provider: 'FAKE_DAAC', // TODO - make this configurable
        objectUrl: accessUrl,
        expectedMd5Hash: file.checksum,
        metadata: {
          filename: file.name,
          collection,
          granuleId,
        },
      },
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

  if (statusCode !== 201) {
    throw new Error(`${granuleId}:: LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
    // Write error log
  }
  return { statusCode, granuleId, filename: file.name, body };
};

export const backupGranule = async (
  creds: AWS.STS.AssumeRoleResponse,
  authToken: string,
  granule: MessageGranule
) => {
  // Generate LZARDS request based on granule file
  // Configure granule files
  console.log(`BackupGranule called on ${JSON.stringify(granule)}`);
  const backupFiles = granule.files.filter((file) => file.backup);
  console.log(`Backup files is ${JSON.stringify(backupFiles)}`);

  // TODO use Core collection identifier code
  return Promise.all(backupFiles.map((file) => makeBackupFileRequest(
    creds,
    authToken,
    file,
    `${granule.dataType}__${granule.version}`,
    granule.granuleId
  )));
};

export const generateAccessCredentials = async () => {
  const sts = new AWS.STS({ region: process.env.REGION });
  const params = {
    //TODO -- make this an env var
    RoleArn: process.env.backup_role_arn as string,
    DurationSeconds: 900,
    RoleSessionName: `${Date.now()}`,
  };
  return sts.assumeRole(params).promise();
};

export const getAuthToken = async () => {
  // TODO add typecheck for all env vars
  const api = process.env.launchpad_api || '';
  const passphrase = await getSecretString(process?.env?.launchpad_passphrase_secret_name || '') || '';
  const certificate = process.env.launchpad_certificate || '';
  const token = await getLaunchpadToken({
    api, passphrase, certificate,
  });
  return token;
};

export const handler = async (event: HandlerEvent) => {
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

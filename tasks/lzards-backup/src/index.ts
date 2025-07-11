import got from 'got';
import Logger from '@cumulus/logger';
import path from 'path';
import isBoolean from 'lodash/isBoolean';
import { Context } from 'aws-lambda';

import { constructCollectionId } from '@cumulus/message/Collections';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { deconstructCollectionId } from '@cumulus/message/Collections';
import { getCollection } from '@cumulus/api-client/collections';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { inTestMode } from '@cumulus/aws-client/test-utils';
import { buildS3Uri } from '@cumulus/aws-client/S3';
import S3ObjectStore from '@cumulus/aws-client/S3ObjectStore';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import { sts } from '@cumulus/aws-client/services';
import { AssumeRoleResponse } from '@cumulus/aws-client/STS';
import {
  constructDistributionUrl,
  fetchDistributionBucketMap,
} from '@cumulus/distribution-utils';

import { getAuthToken } from '@cumulus/lzards-api-client';
import {
  ChecksumError,
  CollectionNotDefinedError,
  CollectionInvalidRegexpError,
  CollectionIdentifiersNotProvidedError,
  InvalidUrlTypeError,
} from './errors';
import { isFulfilledPromise } from './typeGuards';
import {
  ApiGranule,
  BackupConfig,
  HandlerEvent,
  MakeBackupFileRequestResult,
  MessageGranule,
  MessageGranuleFilesObject,
  MessageGranuleFromStepOutput,
} from './types';

const log = new Logger({ sender: '@cumulus/lzards-backup' });

const S3_LINK_EXPIRY_SECONDS_DEFAULT = 3600;
const CREDS_EXPIRY_SECONDS = S3_LINK_EXPIRY_SECONDS_DEFAULT;

const getLzardsProviderOrDefault = (lzardsProvider: string | undefined) => lzardsProvider || process.env.lzards_provider || '';

export const generateCloudfrontUrl = async (params: {
  Bucket: string,
  Key: string,
  cloudfrontEndpoint?: string,
}) => {
  const distributionBucketMap = await fetchDistributionBucketMap();
  return constructDistributionUrl(
    params.Bucket,
    params.Key,
    distributionBucketMap,
    params.cloudfrontEndpoint
  );
};

export const generateDirectS3Url = async (params: {
  roleCreds: AssumeRoleResponse,
  Bucket: string,
  Key: string,
  usePassedCredentials?: boolean
}) => {
  const { roleCreds, Key, Bucket, usePassedCredentials } = params;
  const region = process.env.AWS_REGION || 'us-east-1';
  const secretAccessKey = roleCreds?.Credentials?.SecretAccessKey;
  const sessionToken = roleCreds?.Credentials?.SessionToken;
  const accessKeyId = roleCreds?.Credentials?.AccessKeyId;
  const expiration = roleCreds?.Credentials?.Expiration;

  const s3AccessTimeoutSeconds = process.env.lzards_s3_link_timeout
    ? Number(process.env.lzards_s3_link_timeout) : S3_LINK_EXPIRY_SECONDS_DEFAULT;

  let s3Config;
  if ((!inTestMode() || usePassedCredentials) && (secretAccessKey && accessKeyId)) {
    s3Config = {
      region,
      credentials: {
        secretAccessKey,
        accessKeyId,
        sessionToken,
        expiration,
      },
    };
  }
  const s3ObjectStore = new S3ObjectStore(s3Config);
  const s3Uri = buildS3Uri(Bucket, Key);
  return await s3ObjectStore.signGetObject(s3Uri, {}, {}, { expiresIn: s3AccessTimeoutSeconds });
};

export const generateAccessUrl = async (params: {
  Bucket: string,
  Key: string,
  urlConfig: {
    roleCreds: AssumeRoleResponse,
    urlType?: string,
    cloudfrontEndpoint?: string,
  },
}) => {
  const {
    Bucket,
    Key,
    urlConfig: {
      roleCreds,
      urlType,
      cloudfrontEndpoint,
    },
  } = params;

  try {
    switch ((urlType || 's3')) {
      case 's3': return await generateDirectS3Url({ roleCreds, Bucket, Key });
      case 'cloudfront': return await generateCloudfrontUrl({ Bucket, Key, cloudfrontEndpoint });
      default: throw new InvalidUrlTypeError(`${urlType} is not a recognized type for access URL generation`);
    }
  } catch (error) {
    log.error(`${urlType} access URL generation failed for s3://${Bucket}/${Key}: ${error}`);
    throw error;
  }
};

export const setLzardsChecksumQueryType = (
  file: MessageGranuleFilesObject,
  granuleId: string
) => {
  if (file.checksumType?.toLowerCase() === 'md5') {
    return { expectedMd5Hash: file.checksum };
  }
  if (file.checksumType?.toLowerCase() === 'sha256') {
    return { expectedSha256Hash: file.checksum };
  }
  if (file.checksumType?.toLowerCase() === 'sha512') {
    return { expectedSha512Hash: file.checksum };
  }
  log.error(`${granuleId}: File ${buildS3Uri(file.bucket, file.key)} did not have a checksum or supported checksumType defined`);
  throw new ChecksumError(`${granuleId}: File ${buildS3Uri(file.bucket, file.key)} did not have a checksum or checksumType defined`);
};

export const postRequestToLzards = async (params: {
  accessUrl: string,
  authToken: string,
  collection: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
  provider: string,
  createdAt: number,
  producerGranuleId: string,
  lzardsProvider?: string,
}) => {
  const {
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
    provider,
    createdAt,
    producerGranuleId,
    lzardsProvider,
  } = params;

  const configuredLzardsProvider = getLzardsProviderOrDefault(lzardsProvider);
  if (!configuredLzardsProvider) {
    log.warn(
      'Warning - no LZARDS provider set in the configuration object or Cumulus `lzards_provider` configuration.  Backup may fail.'
    );
  }
  const lzardsApiUrl = getRequiredEnvVar('lzards_api');
  const checksumConfig = setLzardsChecksumQueryType(file, granuleId);

  try {
    return await got.post(lzardsApiUrl,
      {
        json: {
          provider: configuredLzardsProvider,
          objectUrl: accessUrl,
          metadata: {
            filename: buildS3Uri(file.bucket, file.key),
            collection,
            granuleId,
            provider,
            createdAt,
            producerGranuleId,
          },
          ...checksumConfig,
        },
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
  } catch (error) {
    log.error('got encountered error:', error);
    if (error.options) log.debug('erroring request:', JSON.stringify(error.options));
    if (error.response) log.debug('error response:', JSON.stringify(error.response.body));
    throw error;
  }
};

export const makeBackupFileRequest = async (params: {
  backupConfig: BackupConfig
  collectionId: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
  provider: string,
  createdAt: number,
  producerGranuleId: string,
  lzardsPostMethod?: typeof postRequestToLzards,
  generateAccessUrlMethod?: typeof generateAccessUrl,
}): Promise<MakeBackupFileRequestResult> => {
  const {
    collectionId,
    backupConfig,
    backupConfig: { authToken },
    file,
    granuleId,
    provider,
    createdAt,
    producerGranuleId,
    lzardsPostMethod = postRequestToLzards,
    generateAccessUrlMethod = generateAccessUrl,
  } = params;

  try {
    const { key: Key, bucket: Bucket } = file;
    log.info(`${granuleId}: posting backup request to LZARDS: ${buildS3Uri(file.bucket, file.key)}`);
    const accessUrl = await generateAccessUrlMethod({
      Bucket,
      Key,
      urlConfig: backupConfig,
    });
    log.info(`collectionId: ${collectionId}`);
    const { statusCode, body } = await lzardsPostMethod({
      accessUrl,
      authToken,
      lzardsProvider: backupConfig.lzardsProvider,
      collection: collectionId,
      file,
      granuleId,
      provider,
      createdAt,
      producerGranuleId,
    });
    if (statusCode !== 201) {
      log.error(`${granuleId}: Request failed - LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
      return {
        statusCode, granuleId, collectionId, filename: buildS3Uri(file.bucket, file.key), provider, createdAt, body, status: 'FAILED', producerGranuleId,
      };
    }
    return {
      statusCode, granuleId, collectionId, filename: buildS3Uri(file.bucket, file.key), provider, createdAt, body, status: 'COMPLETED', producerGranuleId,
    };
  } catch (error) {
    log.error(`${granuleId}: LZARDS request failed: ${error}`);
    return {
      granuleId,
      collectionId,
      filename: buildS3Uri(file.bucket, file.key),
      provider,
      createdAt,
      producerGranuleId,
      body: JSON.stringify({ name: error.name, stack: error.stack }),
      status: 'FAILED',
    };
  }
};

export const shouldBackupFile = (
  fileName: string,
  collectionConfig: CollectionRecord
): boolean => {
  const collectionFiles = collectionConfig?.files || [];
  const matchingConfig = collectionFiles.filter(
    ({ regex }) => fileName.match(regex)
  );
  if (matchingConfig.length > 1) {
    const errString = `Multiple files matched configured regexp for ${JSON.stringify(collectionConfig)},${fileName}`;
    log.error(errString);
    throw new CollectionInvalidRegexpError(errString);
  }
  if (matchingConfig[0]?.lzards?.backup) return true;
  return false;
};

export const getGranuleCollection = async (params: {
  collectionName: string,
  collectionVersion: string,
  stackPrefix?: string
}): Promise<CollectionRecord> => {
  const prefix = params.stackPrefix || getRequiredEnvVar('stackName');
  const { collectionName, collectionVersion } = params;
  if (!collectionName && !collectionVersion) {
    throw new CollectionNotDefinedError('Collection Name and Version not defined');
  }
  return await getCollection({
    prefix,
    collectionName,
    collectionVersion,
  });
};

export const backupGranule = async (params: {
  granule: MessageGranule,
  backupConfig: BackupConfig,
}) => {
  let granuleCollection : CollectionRecord;
  let collectionId: string = '';
  let name;
  let version;
  const { granule, backupConfig } = params;
  const messageGranule = granule as MessageGranuleFromStepOutput;
  const apiGranule = granule as ApiGranule;
  log.info(`${granule.granuleId}: Backup called on granule: ${JSON.stringify(granule)}`);

  try {
    if (apiGranule.collectionId) {
      const collectionNameAndVersion = deconstructCollectionId(apiGranule.collectionId);
      name = collectionNameAndVersion.name;
      version = collectionNameAndVersion.version;
      collectionId = apiGranule.collectionId;
    } else if (messageGranule.dataType && messageGranule.version) {
      name = messageGranule.dataType;
      version = messageGranule.version;
      collectionId = constructCollectionId(name, version);
    } else {
      log.error(`${JSON.stringify(granule)}: Granule did not have [collectionId] or [dataType and version] and was unable to identify a collection.`);
      throw new CollectionIdentifiersNotProvidedError('[dataType and version] or [collectionId] required.');
    }

    granuleCollection = await getGranuleCollection({
      collectionName: name,
      collectionVersion: version,
    });

    const backupFiles = granule.files.filter(
      (file) => shouldBackupFile(path.basename(file.key), granuleCollection)
    );

    log.info(`${JSON.stringify(granule)}: Backing up ${JSON.stringify(backupFiles)}`);
    return Promise.all(backupFiles.map((file) => makeBackupFileRequest({
      backupConfig,
      file,
      collectionId,
      granuleId: granule.granuleId,
      provider: granule.provider,
      createdAt: granule.createdAt,
      producerGranuleId: granule.producerGranuleId,
    })));
  } catch (error) {
    if (error instanceof CollectionIdentifiersNotProvidedError) {
      log.error(`Unable to find collection for ${granule.granuleId}: Granule (${granule.granuleId}) will not be backed up.`);
    } else if (error instanceof CollectionNotDefinedError) {
      log.error(`${granule.granuleId}: Granule did not have a properly defined collection and version, or refer to a collection that does not exist in the database`);
      log.error(`${granule.granuleId}: Granule (${granule.granuleId}) will not be backed up.`);
    }
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
  const roleCreds = await sts().assumeRole(params);
  return roleCreds as AssumeRoleResponse;
};

export const backupGranulesToLzards = async (
  event: HandlerEvent,
  _context?: Context,
  getAuthTokenMethod: typeof getAuthToken = getAuthToken
) => {
  // Given an array of granules, submit each file for backup.
  log.warn(`Running backup on ${JSON.stringify(event)}`);
  const roleCreds = await generateAccessCredentials();
  const authToken = await getAuthTokenMethod();

  const backupConfig = {
    ...event.config,
    authToken,
    roleCreds,
  };

  const failTaskWhenFileBackupFail = isBoolean(backupConfig.failTaskWhenFileBackupFail) ?
    backupConfig.failTaskWhenFileBackupFail : false;

  const backupPromises = (event.input.granules.map(
    (granule) => backupGranule({ granule, backupConfig })
  ));

  const backupResults = await Promise.allSettled(backupPromises);

  // If there are uncaught exceptions or any backup request fails, we want to fail the task.
  if (backupResults.some((result) => result.status === 'rejected'
    || (failTaskWhenFileBackupFail && result.value.some((value) => value.status === 'FAILED')))) {
    log.error('Some LZARDS backup results failed due to internal failure');
    log.error('Manual reconciliation required - some backup requests may have processed');
    log.error(`Full output: ${JSON.stringify(backupResults)}`);
    throw new Error(`${JSON.stringify(backupResults)}`);
  }
  const filteredResults = backupResults.filter(
    (result) => isFulfilledPromise(result)
  ) as PromiseFulfilledResult<MakeBackupFileRequestResult[]>[];
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

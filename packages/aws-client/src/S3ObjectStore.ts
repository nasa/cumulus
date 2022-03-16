import { URL } from 'url';

import { S3, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import Logger from '@cumulus/logger';
import { headObject, parseS3Uri } from './S3';
import { awsClient } from './client';

// Code modified from https://github.com/nasa/harmony/blob/main/app/util/object-store.ts

const log = new Logger({ sender: '@cumulus/aws-client/S3ObjectStore' });

/**
 * Class to use when interacting with S3
 *
 */
class S3ObjectStore {
  private readonly s3: S3;

  constructor() {
    this.s3 = awsClient(S3, '2006-03-01', { signatureVersion: 'v4' })();
  }

  async getS3SignedUrlWithCustomQueryParams(
    command: GetObjectCommand | HeadObjectCommand,
    queryParams: { [key: string]: string }
  ) {
    const middlewareName = 'customQueryParams';
    this.s3.middlewareStack.addRelativeTo(
      (next: any) => (args: any) => {
        const { request } = args;
        request.query = {
          ...queryParams,
          ...request.query,
        };
        return next(args);
      },
      {
        name: middlewareName,
        relation: 'before',
        toMiddleware: 'presignInterceptMiddleware',
      }
    );
    const signedUrl = await getSignedUrl(this.s3, command);
    this.s3.middlewareStack.remove(middlewareName);
    return signedUrl;
  }

  /**
   * Returns an HTTPS URL that can be used to perform a GET on the given object
   * store URL
   *
   * @param {string} objectUrl - the URL of the object to sign
   * @param {string} [options] - options to pass to S3.getObject
   * @param {string} [queryParams] - a mapping of parameter key/values to put in the URL
   * @returns {Promise<string>} a signed URL
   * @throws TypeError - if the URL is not a recognized protocol or cannot be parsed
   */
  async signGetObject(
    objectUrl: string,
    options: { [key: string]: string } = {},
    queryParams: { [key: string]: string }
  ): Promise<string> {
    log.info(`Executing signGetObject with objectUrl: ${objectUrl}, options: ${JSON.stringify(options)}, queryParams: ${JSON.stringify(queryParams)}`);

    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }

    const { Bucket, Key } = parseS3Uri(objectUrl);

    await headObject(Bucket, Key);

    const command = new GetObjectCommand({ Bucket, Key, ...options });
    const signedUrl = await this.getS3SignedUrlWithCustomQueryParams(command, queryParams);

    log.debug(`Signed GetObject request URL: ${signedUrl}`);

    return signedUrl;
  }

  /**
   * Returns an HTTPS URL that can be used to perform a HEAD on the given object
   * store URL
   *
   * @param {string} objectUrl - the URL of the object to sign
   * @param {string} [options] - options to pass to S3.getObject
   * @param {string} [queryParams] - a mapping of parameter key/values to put in the URL
   * @returns {Promise<string>} a signed URL
   * @throws TypeError - if the URL is not a recognized protocol or cannot be parsed
   */
  async signHeadObject(
    objectUrl: string,
    options: { [key: string]: string } = {},
    queryParams: { [key: string]: string }
  ): Promise<string> {
    log.info(`Executing signHeadObject with objectUrl: ${objectUrl}, options: ${JSON.stringify(options)}, queryParams: ${JSON.stringify(queryParams)}`);
    const url = new URL(objectUrl);

    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }

    const { Bucket, Key } = parseS3Uri(objectUrl);

    const command = new HeadObjectCommand({ Bucket, Key, ...options });
    const signedUrl = await this.getS3SignedUrlWithCustomQueryParams(command, queryParams);

    log.debug(`Signed HeadObject request URL: ${signedUrl}`);

    return signedUrl;
  }
}

export = S3ObjectStore;

import aws from 'aws-sdk';
import * as querystring from 'querystring';
import { URL } from 'url';
import { s3 } from './services';
import { headObject, parseS3Uri } from './S3';

/**
 * Class to use when interacting with S3
 *
 */
export class S3ObjectStore {
  s3: aws.S3;

  constructor() {
    this.s3 = s3();
  }

  /**
   * Returns an HTTPS URL that can be used to perform a GET on the given object
   * store URL
   *
   * @param {string} objectUrl - the URL of the object to sign
   * @param {string} params - an optional mapping of parameter key/values to put in the URL
   * @returns {Promise<string>} a signed URL
   * @throws TypeError - if the URL is not a recognized protocol or cannot be parsed
   */
  async signGetObject(objectUrl: string, params: { [key: string]: string }): Promise<string> {
    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }

    const { Bucket, Key } = parseS3Uri(objectUrl);

    // Verifies that the object exists, or throws NotFound
    await headObject(Bucket, Key);
    const req = this.s3.getObject({ Bucket, Key });

    if (params && req.on) {
      (req.on('build', () => { req.httpRequest.path += `?${querystring.stringify(params)}`; }));
    }
    // TypeScript doesn't recognize that req has a presign method.  It does.
    const result = await (req as any).presign();
    return result;
  }
}

/**
 * Returns a class to interact with the object store appropriate for
 * the provided protocol, or null if no such store exists.
 *
 * @param {string} protocol - the protocol used in object store URLs.  This may be a full URL, in
 *   which case the protocol will be read from the front of the URL.
 * @returns {S3ObjectStore} an object store for interacting with the given protocol
 */
export function objectStoreForProtocol(protocol?: string): S3ObjectStore|undefined {
  if (!protocol) {
    return undefined;
  }
  // Make sure the protocol is lowercase and does not end in a colon (as URL parsing produces)
  const normalizedProtocol = protocol.toLowerCase().split(':')[0];
  if (normalizedProtocol === 's3') {
    return new S3ObjectStore();
  }
  return undefined;
}

/**
 * Returns the default object store for this instance of Harmony.  Allows requesting an
 * object store without first knowing a protocol.
 *
 * @returns {S3ObjectStore} the default object store for Harmony.
 */
export function defaultObjectStore(): S3ObjectStore {
  return new S3ObjectStore();
}

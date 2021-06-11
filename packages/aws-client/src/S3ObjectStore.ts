import * as querystring from 'querystring';
import { URL } from 'url';
import { s3 } from './services';
import { headObject, parseS3Uri } from './S3';

// Code modified from https://github.com/nasa/harmony/blob/main/app/util/object-store.ts

/**
 * Class to use when interacting with S3
 *
 */
class S3ObjectStore {
  private readonly s3: AWS.S3;

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
  async signGetObject(
    objectUrl: string,
    params: { [key: string]: string }
  ): Promise<string> {
    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }

    const { Bucket, Key } = parseS3Uri(objectUrl);

    // Verifies that the object exists, or throws NotFound
    await headObject(Bucket, Key);

    let req: any;
    if (params && params.Range) {
      req = this.s3.getObject({ Bucket, Key, Range: params.Range });
    } else {
      req = this.s3.getObject({ Bucket, Key });
    }

    if (params && req.on) {
      (req.on('build', () => { req.httpRequest.path += `?${querystring.stringify(params)}`; }));
    }

    // TypeScript doesn't recognize that req has a presign method.  It does.
    const result = await (req as any).presign();
    return result;
  }

  /**
   * Returns an HTTPS URL that can be used to perform a HEAD on the given object
   * store URL
   *
   * @param {string} objectUrl - the URL of the object to sign
   * @param {string} params - an optional mapping of parameter key/values to put in the URL
   * @returns {Promise<string>} a signed URL
   * @throws TypeError - if the URL is not a recognized protocol or cannot be parsed
   */
  async signHeadObject(
    objectUrl: string,
    params: { [key: string]: string }
  ): Promise<string> {
    const url = new URL(objectUrl);
    if (url.protocol.toLowerCase() !== 's3:') {
      throw new TypeError(`Invalid S3 URL: ${objectUrl}`);
    }

    const { Bucket, Key } = parseS3Uri(objectUrl);

    let req: any;
    if (params && params.Range) {
      req = this.s3.headObject({ Bucket, Key, Range: params.Range });
    } else {
      req = this.s3.headObject({ Bucket, Key });
    }

    if (params && req.on) {
      (req.on('build', () => { req.httpRequest.path += `?${querystring.stringify(params)}`; }));
    }

    // TypeScript doesn't recognize that req has a presign method.  It does.
    const result = await (req as any).presign();
    return result;
  }
}

export = S3ObjectStore;

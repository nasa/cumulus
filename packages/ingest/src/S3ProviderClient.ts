import * as S3 from '@cumulus/aws-client/S3';
import * as log from '@cumulus/common/log';
import * as errors from '@cumulus/errors';
import { basename, dirname, join } from 'path';
import { ProviderClient, S3ProviderClientListItem, isS3ObjectListItem } from './types';

class S3ProviderClient implements ProviderClient {
  private readonly bucket: string;

  constructor({ bucket }: { bucket?: string } = {}) {
    if (!bucket) throw new TypeError('bucket is required');
    this.bucket = bucket;
  }

  /**
   * Download a remote file to disk
   *
   * @param {Object} params
   * @param {string} params.remotePath - the full path to the remote file to be fetched
   * @param {string} params.localPath - the full local destination file path
   * @param {string} params.remoteAltBucket - alternate per-file bucket override to this.bucket
   * bucket
   * @returns {Promise<string>} - the path that the file was saved to
   */
  async download(params: {
    remotePath: string,
    localPath: string,
    remoteAltBucket?: string,
  }): Promise<string> {
    const { remotePath, localPath, remoteAltBucket } = params;

    const remoteBucket = remoteAltBucket || this.bucket;

    const remoteUrl = `s3://${remoteBucket}/${remotePath}`;
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    const s3Obj = {
      Bucket: remoteBucket,
      Key: remotePath,
    };

    const retval = await S3.downloadS3File(s3Obj, localPath);
    log.info(`Finishing downloading ${remoteUrl}`);

    return retval;
  }

  /**
   * List all files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @returns {Promise<Array>} a list of files
   * @private
   */
  async list(path: string): Promise<S3ProviderClientListItem[]> {
    const objects = await S3.listS3ObjectsV2({
      Bucket: this.bucket,
      FetchOwner: true,
      Prefix: path,
    });

    if (!objects) return [];

    return objects.map((object) => {
      if (!isS3ObjectListItem(object)) {
        throw new TypeError(`S3 object ${object} did not have expected type`);
      }
      return {
        name: basename(object.Key),
        // If the object is at the top level of the bucket, path.dirname is going
        // to return "." as the dirname.  It should instead be undefined.
        path: dirname(object.Key) === '.' ? undefined : dirname(object.Key),
        size: object.Size,
        time: object.LastModified.valueOf(),
      };
    });
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {Object} params - the full path to the remote file to be fetched
   * @param {string} params.sourceKey - the full path to the remote file to be fetched
   * @param {string} params.bucket - destination s3 bucket of the file
   * @param {string} params.destinationBucket - destination s3 bucket of the file
   * @param {string} params.destinationKey - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async sync(
    params: {
      bucket?: string,
      destinationBucket: string,
      destinationKey: string,
      fileRemotePath: string,
    }
  ): Promise<{ s3uri: string, etag: string }> {
    const { fileRemotePath, destinationBucket, destinationKey, bucket } = params;
    const sourceBucket = bucket || this.bucket;
    const sourceKey = fileRemotePath;

    try {
      const sourceObject = await S3.headObject(sourceBucket, sourceKey);
      const s3uri = S3.buildS3Uri(destinationBucket, destinationKey);

      // 0 byte files cannot be copied with multipart upload,
      // so use a regular S3 PUT
      if (sourceObject.ContentLength === 0) {
        const { CopyObjectResult } = await S3.s3CopyObject({
          CopySource: join(sourceBucket, sourceKey),
          Bucket: destinationBucket,
          Key: destinationKey,
        });

        // This error should never actually be reached in practice. It's a
        // necessary workaround for bad typings in the AWS SDK.
        //
        // https://github.com/aws/aws-sdk-js/issues/1719
        if (!CopyObjectResult || !CopyObjectResult.ETag) {
          throw new Error(
            `ETag could not be determined for copy of ${S3.buildS3Uri(sourceBucket, sourceKey)} to ${s3uri}`
          );
        }

        const etag = CopyObjectResult.ETag;
        return { s3uri, etag };
      }

      const { etag } = await S3.multipartCopyObject({
        sourceBucket,
        sourceKey,
        sourceObject,
        destinationBucket,
        destinationKey,
        copyTags: true,
      });
      return { s3uri, etag };
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        const sourceUrl = S3.buildS3Uri(sourceBucket, fileRemotePath);
        throw new errors.FileNotFound(`Source file not found ${sourceUrl}`);
      }

      throw error;
    }
  }

  /* eslint-disable @typescript-eslint/no-empty-function */
  async connect(): Promise<void> {}

  async end(): Promise<void> {}
  /* eslint-enable @typescript-eslint/no-empty-function */
}

export = S3ProviderClient;

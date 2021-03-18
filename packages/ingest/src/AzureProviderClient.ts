import * as log from '@cumulus/common/log';
import * as S3 from '@cumulus/aws-client/S3';
import { basename, dirname } from 'path';
import {
  BlobServiceClient,
  ContainerClient,
} from '@azure/storage-blob';
import { ProviderClient, ProviderClientListItem } from './types';

interface AzureProviderClientConstructorParams {
  container: string;
  connectionString: string;
}

class AzureProviderClient implements ProviderClient {
  private readonly container: string;
  private readonly blobServiceClient: BlobServiceClient;
  private readonly containerClient: ContainerClient;

  constructor(params: AzureProviderClientConstructorParams) {
    if (!params.container) throw new TypeError('container is required');
    this.container = params.container;

    this.blobServiceClient = BlobServiceClient.fromConnectionString(params.connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(this.container);
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise<string>} - the path that the file was saved to
   */
  async download(remotePath: string, localPath: string): Promise<string> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(remotePath);
    await blockBlobClient.downloadToFile(localPath);
    log.info(`Finishing downloading ${remotePath}`);

    return localPath;
  }

  /**
   * List all files from a given endpoint
   *
   * @param {string} path - the remote path to list
   * @returns {Promise<Array>} a list of files
   * @private
   */
  async list(path: string): Promise<ProviderClientListItem[]> {
    const blobs = this.containerClient.listBlobsFlat({ prefix: path });
    const objects = [];

    // eslint-disable-next-line no-restricted-syntax
    for await (const blob of blobs) {
      const lastModifiedDate = blob.properties.lastModified;
      objects.push({
        name: basename(blob.name),
        path: dirname(blob.name),
        time: lastModifiedDate.getTime(),
        size: blob.properties.contentLength || 0, // make typescript happy
      });
    }

    return objects;
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {Object} params - the full path to the remote file to be fetched
   * @param {string} params.fileRemotePath - the full path to the remote file to be fetched
   * @param {string} params.bucket - source Azure container of the file
   * @param {string} params.destinationBucket - destination Azure container of the file
   * @param {string} params.destinationKey - destination Azure key of the file
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
  ): Promise<{s3uri: string, etag: string}> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(params.fileRemotePath);
    const downloadBlockBlobResponse = await blockBlobClient.download();

    // Need to test this with large files
    const uploadResponse = await S3.promiseS3Upload({
      Bucket: params.destinationBucket,
      Key: params.destinationKey,
      // @ts-ignore
      Body: downloadBlockBlobResponse.blobDownloadStream,
    });

    return {
      s3uri: S3.buildS3Uri(params.destinationBucket, params.destinationKey),
      etag: uploadResponse.ETag,
    };
  }

  /* eslint-disable @typescript-eslint/no-empty-function */
  async connect(): Promise<void> {}

  async end(): Promise<void> {}
  /* eslint-enable @typescript-eslint/no-empty-function */
}

export = AzureProviderClient;

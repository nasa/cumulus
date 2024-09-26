import get from 'lodash/get';
import * as log from '@cumulus/common/log';
import mime from 'mime-types';
import path from 'path';
import { s3 } from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import Client from 'ssh2-sftp-client';
import { ConnectConfig } from 'ssh2';

export interface SftpClientConfig {
  host: string,
  port?: number,
  username?: string,
  password?: string,
  privateKey?: string
}

export interface SyncToS3Response {
  s3uri: string,
  etag?: string
}

export interface ListItem {
  name: string,
  path: string,
  type: string,
  size: number,
  time: number
}

export type ListResponse = ListItem[];

export class SftpClient {
  private readonly sftpClient: Client;
  private connected: boolean;
  private readonly clientOptions: ConnectConfig;

  constructor(config: SftpClientConfig) {
    this.connected = false;

    this.clientOptions = {
      host: config.host,
      port: get(config, 'port', 22),
      algorithms: {
        kex: {
          append: [
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
          ],
          prepend: [],
          remove: [],
        },
      },
    };

    if (config.username) this.clientOptions.username = config.username;
    if (config.password) this.clientOptions.password = config.password;
    if (config.privateKey) this.clientOptions.privateKey = config.privateKey;

    this.sftpClient = new Client();
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.sftpClient.connect(this.clientOptions);

    this.connected = true;
  }

  async end(): Promise<void> {
    if (this.connected) {
      await this.sftpClient.end();

      this.connected = false;
    }
  }

  get sftp(): Client {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    return this.sftpClient;
  }

  /**
   * build remote url
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @returns {string} - remote url
   * @private
   */
  buildRemoteUrl(remotePath: string): string {
    if (!this.clientOptions.host) {
      throw new Error('host is not set');
    }

    return `sftp://${path.join(this.clientOptions.host, '/', remotePath)}`;
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise<string>} - the local path that the file was saved to
   */
  async download(remotePath: string, localPath: string): Promise<void> {
    const remoteUrl = this.buildRemoteUrl(remotePath);

    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    await this.sftp.fastGet(remotePath, localPath, {
      concurrency: 0,
    });

    log.info(`Finished downloading ${remoteUrl} to ${localPath}`);
  }

  async unlink(remotePath: string): Promise<void> {
    await this.sftp.delete(remotePath);
  }

  /**
   * Transfer the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async syncToS3(
    remotePath: string,
    bucket: string,
    key: string
  ): Promise<SyncToS3Response> {
    const remoteUrl = this.buildRemoteUrl(remotePath);

    const s3uri = S3.buildS3Uri(bucket, key);

    log.info(`Copying ${remoteUrl} to ${s3uri}`);

    // TODO Issue PR against ssh2-sftp-client to allow for getting a
    // readable stream back, rather than having to access the underlying
    // sftp object.
    // @ts-expect-error
    const sftpReadStream = this.sftp.sftp.createReadStream(remotePath);

    const result = await S3.promiseS3Upload({
      params: {
        Bucket: bucket,
        Key: key,
        Body: sftpReadStream,
        ContentType: mime.lookup(key) || undefined,
      },
    });

    log.info(`Finished copying ${remoteUrl} to ${s3uri}`);

    return { s3uri, etag: result.ETag };
  }

  /**
   * List file in remote path
   *
   * @param {string} remotePath - the remote path to be listed
   * @returns {Promise<ListResponse>} list of file objects
   */
  async list(remotePath: string): Promise<ListResponse> {
    const remoteFiles = await this.sftp.list(remotePath);

    return remoteFiles.map((remoteFile) => ({
      name: remoteFile.name,
      path: remotePath,
      type: remoteFile.type,
      size: remoteFile.size,
      time: remoteFile.modifyTime,
    }));
  }

  /**
   * Transfer an s3 file to remote path
   *
   * @param {Object} s3object
   * @param {string} s3object.Bucket - S3 bucket
   * @param {string} s3object.Key - S3 object key
   * @param {string} remotePath - the full remote destination file path
   * @returns {Promise}
   */
  async syncFromS3(
    s3object: { Bucket: string, Key: string },
    remotePath: string
  ): Promise<void> {
    const s3uri = S3.buildS3Uri(s3object.Bucket, s3object.Key);
    const remoteUrl = this.buildRemoteUrl(remotePath);

    log.info(`Copying ${s3uri} to ${remoteUrl}`);

    const readStream = await S3.getObjectReadStream({
      s3: s3(),
      bucket: s3object.Bucket,
      key: s3object.Key,
    });

    await this.sftp.put(readStream, remotePath);

    log.info(`Finished copying ${s3uri} to ${remoteUrl}`);
  }
}

export default SftpClient;

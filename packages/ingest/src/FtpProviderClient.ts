import JSFtp, { ListError } from 'jsftp';
import { PassThrough } from 'stream';
import log from '@cumulus/common/log';
import S3 from '@cumulus/aws-client/S3';
import isNil from 'lodash/isNil';
import { Socket } from 'net';
import { recursion } from './recursion';
import { lookupMimeType, decrypt } from './util';
import { FtpProviderClientListItem, ProviderClientListItem } from './types';

interface FtpProviderClientConstructorParams {
  host: string;
  port?: number;
  useList?: boolean;
  username?: string;
  password?: string;
  encrypted?: boolean;
}

function isJSFtpError(error: Error | ListError): error is ListError {
  return (error as ListError).text !== undefined && !(error as Error).message;
}

class FtpProviderClient {
  private readonly providerConfig: FtpProviderClientConstructorParams;
  private readonly host: string;
  private ftpClient?: JSFtp;
  private plaintextUsername?: string;
  private plaintextPassword?: string;

  // jsftp.ls is called in _list and uses 'STAT' as a default. Some FTP
  // servers return inconsistent results when using
  // 'STAT' command. We can use 'LIST' in those cases by
  // setting the variable `useList` to true
  constructor(providerConfig: FtpProviderClientConstructorParams) {
    this.providerConfig = providerConfig;
    this.host = providerConfig.host;

    if ((providerConfig.encrypted ?? false) === false) {
      this.plaintextUsername = providerConfig.username ?? 'anonymous';
      this.plaintextPassword = providerConfig.password ?? 'password';
    }
  }

  async getUsername(): Promise<string> {
    if (!this.plaintextUsername) {
      if (!this.providerConfig.username) {
        throw new Error('username not set');
      }

      this.plaintextUsername = await decrypt(this.providerConfig.username);

      if (!this.plaintextUsername) {
        throw new Error('Unable to decrypt username');
      }
    }
    return this.plaintextUsername;
  }

  async getPassword(): Promise<string> {
    if (!this.plaintextPassword) {
      if (!this.providerConfig.password) {
        throw new Error('password not set');
      }

      this.plaintextPassword = await decrypt(this.providerConfig.password);

      if (!this.plaintextPassword) {
        throw new Error('Unable to decrypt password');
      }
    }
    return this.plaintextPassword;
  }

  async buildFtpClient(): Promise<JSFtp> {
    if (isNil(this.ftpClient)) {
      this.ftpClient = new JSFtp({
        host: this.host,
        port: this.providerConfig.port ?? 21,
        user: await this.getUsername(),
        pass: await this.getPassword(),
        useList: this.providerConfig.useList ?? false,
      });
    }
    return this.ftpClient;
  }

  errorHandler(rejectFn: (reason?: any) => void, error: Error | ListError): void {
    let normalizedError = error;
    // error.text is a product of jsftp returning an object with a `text` field to the callback's
    // `err` param, but normally javascript errors have a `message` field. We want to normalize
    // this before throwing it out of the `FtpProviderClient` because it is a quirk of jsftp.
    if (isJSFtpError(error)) {
      const message = `${error.code
        ? `FTP Code ${error.code}: ${error.text}`
        : `FTP error: ${error.text}`} This may be caused by user permissions disallowing the listing.`;
      normalizedError = new Error(message);
    }
    if (!isNil(this.ftpClient)) {
      this.ftpClient.destroy();
    }
    log.error('FtpProviderClient encountered error: ', normalizedError);
    return rejectFn(normalizedError);
  }

  /**
   * Download a remote file to disk
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} localPath - the full local destination file path
   * @returns {Promise.<string>} - the path that the file was saved to
   */
  async download(remotePath: string, localPath: string): Promise<string> {
    const remoteUrl = `ftp://${this.host}/${remotePath}`;
    log.info(`Downloading ${remoteUrl} to ${localPath}`);

    const client = await this.buildFtpClient();

    return new Promise((resolve, reject) => {
      client.on('error', this.errorHandler.bind(this, reject));
      client.get(remotePath, localPath, (err) => {
        if (err) {
          return this.errorHandler(reject, err);
        }
        log.info(`Finishing downloading ${remoteUrl}`);
        client.destroy();
        return resolve(localPath);
      });
    });
  }

  /**
   * List all files from a given endpoint
   * @param {string} path - path to list
   * @param {number} counter - recursive attempt counter
   * @returns {Promise} promise of contents
   * @private
   */
  async _list(path: string, counter = 0): Promise<FtpProviderClientListItem[]> {
    const client = await this.buildFtpClient();
    return new Promise<FtpProviderClientListItem[]>((resolve, reject) => {
      client.on('error', this.errorHandler.bind(this, reject));
      client.ls(path, (err: Error | ListError, data) => {
        if (err) {
          const message = isJSFtpError(err) ? err.text : err.message;
          if (message && message.includes('Timed out') && counter < 3) {
            log.error(`Connection timed out while listing ${path}. Retrying...`);
            return this._list(path, counter + 1).then((r) => {
              log.info(`${counter + 1} retry succeeded`);
              return resolve(r);
            }).catch(this.errorHandler.bind(this, reject));
          }
          return this.errorHandler(reject, err);
        }

        client.destroy();

        return resolve(
          data.map((d) => ({
            name: d.name,
            path: path,
            size: typeof d.size === 'number' ? d.size : Number.parseInt(d.size, 10),
            time: d.time,
            type: d.type,
          }))
        );
      });
    });
  }

  /**
   * List all files from a given endpoint
   * @param {string} path - path to list
   * @returns {Promise}
   */
  async list(path: string): Promise<ProviderClientListItem[]> {
    const listFn = this._list.bind(this);
    const files = await recursion(listFn, path);

    log.info(`${files.length} files were found on ${this.host}`);

    // Type 'type' field is required to support recursive file listing, but
    // should not be part of the returned result.
    return files.map((file) => ({
      name: file.name,
      path: file.path,
      size: file.size,
      time: file.time,
    }));
  }

  /**
   * Download the remote file to a given s3 location
   *
   * @param {string} remotePath - the full path to the remote file to be fetched
   * @param {string} bucket - destination s3 bucket of the file
   * @param {string} key - destination s3 key of the file
   * @returns {Promise.<{ s3uri: string, etag: string }>} an object containing
   *    the S3 URI and ETag of the destination file
   */
  async sync(
    remotePath: string,
    bucket: string,
    key: string
  ): Promise<{s3uri: string, etag: string}> {
    const remoteUrl = `ftp://${this.host}/${remotePath}`;
    const s3uri = S3.buildS3Uri(bucket, key);
    log.info(`Sync ${remoteUrl} to ${s3uri}`);

    const client = await this.buildFtpClient();

    // get readable stream for remote file
    const readable = await new Promise<Socket>((resolve, reject) => {
      client.get(remotePath, (err, socket) => {
        if (err) {
          return this.errorHandler(reject, err);
        }
        return resolve(socket);
      });
    });

    const pass = new PassThrough();
    readable.pipe(pass);

    const params = {
      Bucket: bucket,
      Key: key,
      Body: pass,
      ContentType: lookupMimeType(key),
    };

    try {
      const { ETag: etag } = await S3.promiseS3Upload(params);
      log.info('Uploading to s3 is complete(ftp)', s3uri);

      return { s3uri, etag };
    } finally {
      client.destroy();
    }
  }

  /* eslint-disable @typescript-eslint/no-empty-function */
  async connect(): Promise<void> { }

  async end(): Promise<void> { }
  /* eslint-enable @typescript-eslint/no-empty-function */
}

export = FtpProviderClient;

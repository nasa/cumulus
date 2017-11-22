'use strict';

const fs = require('fs');
const get = require('lodash.get');
const join = require('path').join;
const urljoin = require('url-join');
const cksum = require('cksum');
const checksum = require('checksum');
const logger = require('./log');
const errors = require('@cumulus/common/errors');
const S3 = require('./aws').S3;
const queue = require('./queue');
const sftpMixin = require('./sftp');
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;

const log = logger.child({ file: 'ingest/granule.js' });

class Discover {
  constructor(event) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }
    this.buckets = get(event, 'resources.buckets');
    this.collection = get(event, 'collection.meta');
    this.provider = get(event, 'provider');
    this.event = event;

    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.path = this.collection.provider_path || '/';
    this.endpoint = urljoin(this.host, this.path);
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);

    // create hash with file regex as key
    this.regexes = {};
    this.collection.files.forEach(f => {
      this.regexes[f.regex] = {
        collection: this.collection.name,
        bucket: this.buckets[f.bucket]
      };
    });
  }

  /**
   * Receives a file object and adds granule, bucket and path information
   * extracted from the collection record
   * @param {object} file the file object
   * @returns {object} Updated file with granuleId, bucket and path information
   */
  setGranuleInfo(_file) {
    let granuleId;
    const file = _file;
    let test = new RegExp(this.collection.granuleIdExtraction);
    const match = file.name.match(test);
    if (match) {
      granuleId = match[1];
      for (const f of this.collection.files) {
        test = new RegExp(f.regex);
        if (file.name.match(test)) {
          file.granuleId = granuleId;
          file.bucket = this.buckets[f.bucket];
          if (f.url_path) {
            file.url_path = f.url_path;
          }
          else {
            file.url_path = this.collection.url_path || '/';
          }
        }
      }

      return file;
    }
    return false;
  }

  async discover() {
    // get list of files that matches a given path
    const files = await this.list();

    const updatedFiles = [];
    // select files that match a given collection
    files.forEach(f => {
      const file = this.setGranuleInfo(f);
      if (file) updatedFiles.push(file);
    });
    return await this.findNewGranules(updatedFiles);
  }

  async fileIsNew(file) {
    const exists = await S3.fileExists(file.bucket, file.name);
    return exists ? false : file;
  }

  async findNewGranules(files) {
    const checkFiles = files.map(f => this.fileIsNew(f));
    const t = await Promise.all(checkFiles);
    const newFiles = t.filter(f => f);

    // reorganize by granule
    const granules = {};
    newFiles.forEach(_f => {
      const f = _f;
      const granuleId = f.granuleId;
      delete f.granuleId;
      if (granules[granuleId]) {
        granules[granuleId].files.push(f);
      }
      else {
        granules[granuleId] = {
          granuleId,
          files: [f]
        };
      }
    });

    return Object.keys(granules).map(k => granules[k]);
  }
}

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class DiscoverAndQueue extends Discover {
  async findNewGranules(files) {
    const granules = await super.findNewGranules(files);
    return Promise.all(granules.map(g => queue.queueGranule(this.event, g)));
  }
}


/**
 * This is a base class for ingesting and parsing a single PDR
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */

class Granule {
  constructor(event) {
    if (this.constructor === Granule) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = get(event, 'resources.buckets');
    this.collection = get(event, 'collection.meta');
    this.provider = get(event, 'provider');
    this.event = event;

    this.collection.url_path = this.collection.url_path || '';
    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
    this.checksumFiles = {};

    this.forceDownload = get(event, 'meta.forceDownload', false);
  }

  async ingest(granule) {
    // for each granule file
    // download / verify checksum / upload
    const downloadFiles = granule.files
      .map(f => this.getBucket(f))
      .filter(f => this.filterChecksumFiles(f))
      .map(f => this.ingestFile(f));

    const files = await Promise.all(downloadFiles);

    return {
      granuleId: granule.granuleId,
      files
    };
  }

  getBucket(_file) {
    const file = _file;
    for (const fileDef of this.collection.files) {
      const test = new RegExp(fileDef.regex);
      const match = file.name.match(test);
      if (match) {
        file.bucket = this.buckets[fileDef.bucket];
        file.url_path = fileDef.url_path || this.collection.url_path;
        return file;
      }
    }
    // if not found fall back to default
    file.bucket = this.buckets.private;
    file.url_path = this.collection.url_path || '';
    return file;
  }

  filterChecksumFiles(file) {
    if (file.name.indexOf('.md5') > 0) {
      this.checksumFiles[file.name.replace('.md5', '')] = file;
      return false
    }

    return true
  }

  async _validateChecksum (type, value, tempFile, options) {
    if (!options) options = {}
    let sum = null;

    if (type.toLowerCase() === 'cksum') {
      sum = await this._cksum(tempFile)
    } else {
      sum = await this._hash(type, tempFile, options)
    }

    return value === sum;
  }

  async _cksum (tempFile) {
    return new Promise(function (resolve, reject) {
       fs.createReadStream(tempFile)
         .pipe(cksum.stream((value) => resolve(value.readUInt32BE(0))))
         .on('error', reject)
    });
  }

  async _hash (type, tempFile) {
    const options = { algorithm: type };

    return new Promise(function (resolve, reject) {
       checksum.file(tempFile, options, function (err, sum) {
         if (err) return reject(err);
         resolve(sum);
       });
    });
  }

  /**
   * Ingest individual files
   * @private
   */
  async ingestFile(_file) {
    const file = _file;
    let exists;

    // check if the file exists. if it does skip
    if (!this.forceDownload) {
      exists = await S3.fileExists(file.bucket, join(file.url_path, file.name));
    }
    else {
      exists = false;
    }

    if (!exists) {
      // we considered a direct stream from source to S3 but since
      // it doesn't work with FTP connections, we decided to always download
      // and then upload
      let tempFile;
      try {
        log.info(`downloading ${file.name}`);
        tempFile = await this.download(file.path, file.name);
        log.info(`downloaded ${file.name}`);
      }
      catch (e) {
        if (e.message && e.message.includes('Unexpected HTTP status code: 403')) {
          throw new errors.FileNotFound(
            `${file.filename} was not found on the server with 403 status`
          );
        }
        throw e;
      }

      try {
        let checksumType = null;
        let checksumValue = null;

        if (file.checksumType && file.checksumValue) {
          checksumType = file.checksumType;
          checksumValue = file.checksumValue;
        } else if (this.checksumFiles[file.name]) {
          const checksumInfo = this.checksumFiles[file.name];

          log.info(`downloading ${checksumInfo.name}`);
          const checksumFilepath = await this.download(checksumInfo.path, checksumInfo.name);
          log.info(`downloaded ${checksumInfo.name}`);

          // expecting the type is md5
          checksumType = 'md5';
          checksumValue = fs.readFileSync(checksumFilepath, 'utf8').split(' ')[0];
          fs.unlinkSync(checksumFilepath);
        } else {
          // If there is not a checksum, no need to validate
          return await this.upload(file.bucket, file.url_path, file.name, tempFile);
        }

        const validated = await this._validateChecksum(
          checksumType,
          checksumValue,
          tempFile
        );

        if (validated) {
          await this.upload(file.bucket, file.url_path, file.name, tempFile);
        } else {
          throw new errors.InvalidChecksum(
            `Invalid checksum for ${file.name} with type ${file.checksumType} and value ${file.checksumValue}`
          );
        }
      } catch (e) {
        throw new errors.InvalidChecksum(
          `Error evaluating checksum for ${file.name} with type ${file.checksumType} and value ${file.checksumValue}`
        );
      }

      // delete temp file
      fs.stat(tempFile, function (err, stat) {
        // TODO: figure out why an error is thrown when fs.unlinkSync isn't wrapped in fs.stat
        if (stat) fs.unlinkSync(tempFile)
      })
    }

    file.filename = `s3://${file.bucket}/${join(file.url_path, file.name)}`;
    return file;
  }
}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class SftpDiscoverGranules extends sftpMixin(Discover) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class SftpDiscoverAndQueueGranules extends sftpMixin(DiscoverAndQueue) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class FtpDiscoverGranules extends ftpMixin(Discover) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class FtpDiscoverAndQueueGranules extends ftpMixin(DiscoverAndQueue) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class FtpGranule extends ftpMixin(Granule) {}

/**
 * Ingest Granule from a FTP endpoint.
 *
 * @class
 */

class SftpGranule extends sftpMixin(Granule) {}


/**
 * Ingest Granule from a HTTP endpoint.
 *
 * @class
 */

class HttpGranule extends httpMixin(Granule) {}

/**
* Select a class for discovering or ingesting granules based on protocol
* @param {string} type – `discover` or `ingest`
* @param {string} protocol – `sftp`, `ftp`, or `http`
* @param {boolean} useQueue – set to `true` to queue granules
**/
function selector(type, protocol, q) {
  if (type === 'discover') {
    switch (protocol) {
      case 'sftp':
        return q ? SftpDiscoverAndQueueGranules : SftpDiscoverGranules;
      case 'ftp':
        return q ? FtpDiscoverAndQueueGranules : FtpDiscoverGranules;
      default:
        throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }
  else if (type === 'ingest') {
    switch (protocol) {
      case 'sftp':
        return SftpGranule;
      case 'ftp':
        return FtpGranule;
      case 'http':
        return HttpGranule;
      default:
        throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

module.exports.selector = selector;
module.exports.HttpGranule = HttpGranule;
module.exports.FtpGranule = FtpGranule;
module.exports.SftpGranule = SftpGranule;
module.exports.SftpDiscoverGranules = SftpDiscoverGranules;
module.exports.SftpDiscoverAndQueueGranules = SftpDiscoverAndQueueGranules;
module.exports.FtpDiscoverGranules = FtpDiscoverGranules;
module.exports.FtpDiscoverAndQueueGranules = FtpDiscoverAndQueueGranules;

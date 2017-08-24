'use strict';

const fs = require('fs');
const get = require('lodash.get');
const join = require('path').join;
const urljoin = require('url-join');
const logger = require('./log');
const errors = require('@cumulus/common/errors');
const { S3, StepFunction } = require('./aws');
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
    return this.findNewGranules(updatedFiles);
  }

  async getGranuleStatus(g) {
    const status = await StepFunction.getGranuleStatus(g.granuleId, this.event);
    if (!status) {
      return ['new', g];
    }
    return [status, g];
  }

  async findNewGranules(files) {
    // reorganize by granule
    const hash = {};
    files.forEach(_f => {
      const f = _f;
      const granuleId = f.granuleId;
      delete f.granuleId;
      if (hash[granuleId]) {
        hash[granuleId].files.push(f);
      }
      else {
        hash[granuleId] = {
          granuleId,
          files: [f]
        };
      }
    });
    const granules = Object.values(hash);

    // organize granules by their status
    const status = await Promise.all(granules.map(g => this.getGranuleStatus(g)));

    return {
      new: status.filter(n => n[0] === 'new').map(n => n[1]),
      completed: status.filter(n => n[0] === 'completed').map(n => n[1]),
      failed: status.filter(n => n[0] === 'failed').map(n => n[1])
    };
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
    const toProcess = granules.new.concat(granules.failed);
    const running = await Promise.all(
      Object.values(toProcess).map(g => queue.queueGranule(this.event, g))
    );

    return {
      running: running.filter(r => r), // only pass those have value
      completed: granules.completed,
      failed: []
    };
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

    this.forceDownload = get(event, 'meta.forceDownload', false);
  }

  async ingest(granule) {
    // for each granule file
    // download / verify checksum / upload
    const downloadFiles = granule.files.map(f => this.getBucket(f)).map(f => this.ingestFile(f));
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

      // run the checksum if there is a checksum value available
      // TODO: add support for md5
      if (file.checksumType && file.checksumType.toLowerCase() === 'cksum') {
        //await this._cksum(tempFile, parseInt(file.checksumValue));
      }

      await this.upload(file.bucket, file.url_path, file.name, tempFile);

      // delete temp file
      fs.unlinkSync(tempFile);
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

  //switch (protocol) {
    //case 'sftp':
      //return queue ? s : SftpDiscoverGranules;
    //default:
      //return queue ? FtpDiscoverAndQueueGranules : FtpDiscoverGranules;
  //}
}

module.exports.selector = selector;
module.exports.HttpGranule = HttpGranule;
module.exports.FtpGranule = FtpGranule;
module.exports.SftpGranule = SftpGranule;
module.exports.SftpDiscoverGranules = SftpDiscoverGranules;
module.exports.SftpDiscoverAndQueueGranules = SftpDiscoverAndQueueGranules;
module.exports.FtpDiscoverGranules = FtpDiscoverGranules;
module.exports.FtpDiscoverAndQueueGranules = FtpDiscoverAndQueueGranules;

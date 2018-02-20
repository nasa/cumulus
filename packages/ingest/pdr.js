'use strict';

const path = require('path');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const { MismatchPdrCollection } = require('@cumulus/common/errors');
const parsePdr = require('./parse-pdr').parsePdr;
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;
const sftpMixin = require('./sftp');
const s3Mixin = require('./s3').s3Mixin;
const aws = require('@cumulus/common/aws');
const { S3 } = require('./aws');
const queue = require('./queue');

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP, HTTP or S3 mixing to work
 *
 * @class
 * @abstract
 */
class Discover {
  constructor(
    stack,
    bucket,
    collection,
    provider,
    queueUrl,
    templateUri,
    folder = 'pdrs',
    queueLimit = null
  ) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.stack = stack;
    this.bucket = bucket;
    this.collection = collection;
    this.provider = provider;
    this.folder = folder;
    this.queueUrl = queueUrl;
    this.templateUri = templateUri;

    // get authentication information
    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.path = this.collection.provider_path || '/';
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
    this.limit = queueLimit;
  }

  filterPdrs(pdr) {
    const test = new RegExp(/^(.*\.PDR)$/);
    return pdr.name.match(test) !== null;
  }

  /**
   * discover PDRs from an endpoint
   * @return {Promise}
   * @public
   */

  async discover() {
    let files = await this.list();

    // filter out non pdr files
    files = files.filter(f => this.filterPdrs(f));
    return this.findNewPdrs(files);
  }

  /**
   * Determine if a PDR does not yet exist in S3.
   *
   * @param {Object} pdr - the PDR that's being looked for
   * @param {string} pdr.name - the name of the PDR (in S3)
   * @returns {Promise.<(boolean|Object)>} - a Promise that resolves to false
   *   when the object does already exists in S3, or the passed-in PDR object
   *   if it does not already exist in S3.
   */
  pdrIsNew(pdr) {
    return aws.s3ObjectExists({
      Bucket: this.bucket,
      Key: path.join(this.stack, this.folder, pdr.name)
    }).then((exists) => (exists ? false : pdr));
  }

  /**
   * Determines which of the discovered PDRs are new
   * and has to be parsed by comparing the list of discovered PDRs
   * against a folder on a S3 bucket
   *
   * @param {array} pdrs list of pdr names (do not include the full path)
   * @return {Promise}
   * @private
   */
  async findNewPdrs(pdrs) {
    const checkPdrs = pdrs.map(pdr => this.pdrIsNew(pdr));
    const _pdrs = await Promise.all(checkPdrs);

    const newPdrs = _pdrs.filter(p => p);
    return newPdrs;
  }
}

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP, HTTP or S3 mixing to work
 *
 * @class
 * @abstract
 */
class DiscoverAndQueue extends Discover {
  async findNewPdrs(pdrs) {
    let newPdrs = await super.findNewPdrs(pdrs);
    if (this.limit) newPdrs = newPdrs.slice(0, this.limit);
    return Promise.all(newPdrs.map((p) => queue.queuePdr(
      this.queueUrl,
      this.templateUri,
      this.provider,
      this.collection,
      p
    )));
  }
}


/**
 * This is a base class for ingesting and parsing a single PDR
 * It must be mixed with a FTP, HTTP or S3 mixing to work
 *
 * @class
 * @abstract
 */
class Parse {
  constructor(
    pdr,
    stack,
    bucket,
    collection,
    provider,
    queueUrl,
    templateUri,
    folder = 'pdrs') {
    if (this.constructor === Parse) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.pdr = pdr;
    this.stack = stack;
    this.bucket = bucket;
    this.collection = collection;
    this.provider = provider;
    this.folder = folder;
    this.queueUrl = queueUrl;
    this.templateUri = templateUri;

    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);

    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
  }

  extractGranuleId(filename, regex) {
    const test = new RegExp(regex);
    const match = filename.match(test);

    if (match) {
      return match[1];
    }
    return filename;
  }

  /**
   * Copy the PDR to S3 and parse it
   *
   * @return {Promise}
   * @public
   */
  async ingest() {
    // download
    const pdrLocalPath = await this.download(this.pdr.path, this.pdr.name);

    // parse the PDR
    const granules = await this.parse(pdrLocalPath);

    // upload only if the parse was successful
    await this.upload(
      this.bucket,
      path.join(this.stack, this.folder),
      this.pdr.name,
      pdrLocalPath
    );

    // return list of all granules found in the PDR
    return granules;
  }

  /**
   * This method parses a PDR and returns all the granules in it
   *
   * @param {string} pdrLocalPath PDR path on disk
   * @return {Promise}
   * @public
   */
  parse(pdrLocalPath) {
    // catching all parse errors here to mark the pdr as failed
    // if any error occured
    const parsed = parsePdr(pdrLocalPath, this.collection, this.pdr.name);

    // each group represents a Granule record.
    // After adding all the files in the group to the Queue
    // we create the granule record (moment of inception)
    log.info(
      { pdrName: this.pdr.name },
      `There are ${parsed.granulesCount} granules in ${this.pdr.name}`
    );
    log.info(
      { pdrName: this.pdr.name },
      `There are ${parsed.filesCount} files in ${this.pdr.name}`
    );

    return parsed;
  }
}

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP, HTTP or S3 mixing to work
 *
 * @class
 * @abstract
 */
class ParseAndQueue extends Parse {
  async ingest() {
    const payload = await super.ingest();
    const collections = {};

    //payload.granules = payload.granules.slice(0, 10);

    // make sure all parsed granules have the correct collection
    for (const g of payload.granules) {
      if (!collections[g.dataType]) {
        // if the collection is not provided in the payload
        // get it from S3
        if (g.dataType !== this.collection.name) {
          const bucket = this.bucket;
          const key = `${this.stack}` +
                      `/collections/${g.dataType}.json`;
          let file;
          try {
            file = await S3.get(bucket, key);
          }
          catch (e) {
            throw new MismatchPdrCollection(
              `${g.dataType} dataType in ${this.pdr.name} doesn't match ${this.collection.name}`
            );
          }

          collections[g.dataType] = JSON.parse(file.Body.toString());
        }
        else {
          collections[g.dataType] = this.collection;
        }
      }

      g.granuleId = this.extractGranuleId(
        g.files[0].name,
        collections[g.dataType].granuleIdExtraction
      );
    }

    log.info(`Queueing ${payload.granules.length} granules to be processed`);

    const names = await Promise.all(
      payload.granules.map((g) => queue.queueGranule(
        g,
        this.queueUrl,
        this.templateUri,
        this.provider,
        collections[g.dataType],
        this.pdr,
        this.stack,
        this.bucket
      ))
    );

    let isFinished = false;
    const running = names.filter((n) => n[0] === 'running').map((n) => n[1]);
    const completed = names.filter((n) => n[0] === 'completed').map((n) => n[1]);
    const failed = names.filter((n) => n[0] === 'failed').map((n) => n[1]);
    if (running.length === 0) {
      isFinished = true;
    }

    return { running, completed, failed, isFinished };
  }
}

/**
 * Discover PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscover extends ftpMixin(Discover) {}

/**
 * Discover PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscover extends httpMixin(Discover) {}

/**
 * Discover PDRs from a SFTP endpoint.
 *
 * @class
 */

class SftpDiscover extends sftpMixin(Discover) {}

/**
 * Discover PDRs from a S3 endpoint.
 *
 * @class
 */

class S3Discover extends s3Mixin(Discover) {}

/**
 * Discover and Queue PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscoverAndQueue extends ftpMixin(DiscoverAndQueue) {}

/**
 * Discover and Queue PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscoverAndQueue extends httpMixin(DiscoverAndQueue) {}

/**
 * Discover and Queue PDRs from a SFTP endpoint.
 *
 * @class
 */

class SftpDiscoverAndQueue extends sftpMixin(DiscoverAndQueue) {}

/**
 * Discover and Queue PDRs from a S3 endpoint.
 *
 * @class
 */

class S3DiscoverAndQueue extends s3Mixin(DiscoverAndQueue) {}

/**
 * Parse PDRs downloaded from a FTP endpoint.
 *
 * @class
 */

class FtpParse extends ftpMixin(Parse) {}

/**
 * Parse PDRs downloaded from a HTTP endpoint.
 *
 * @class
 */

class HttpParse extends httpMixin(Parse) {}

/**
 * Parse PDRs downloaded from a SFTP endpoint.
 *
 * @class
 */

class SftpParse extends sftpMixin(Parse) {}

/**
 * Parse PDRs downloaded from a S3 endpoint.
 *
 * @class
 */

class S3Parse extends s3Mixin(Parse) {}

/**
 * Parse and Queue PDRs downloaded from a FTP endpoint.
 *
 * @class
 */

class FtpParseAndQueue extends ftpMixin(ParseAndQueue) {}

/**
 * Parse and Queue PDRs downloaded from a HTTP endpoint.
 *
 * @class
 */

class HttpParseAndQueue extends httpMixin(ParseAndQueue) {}

/**
 * Parse and Queue PDRs downloaded from a SFTP endpoint.
 *
 * @classc
 */

class SftpParseAndQueue extends sftpMixin(ParseAndQueue) {}

/**
 * Parse and Queue PDRs downloaded from a S3 endpoint.
 *
 * @classc
 */

class S3ParseAndQueue extends s3Mixin(ParseAndQueue) {}

/**
 * Select a class for discovering PDRs based on protocol
 *
 * @param {string} type - `discover` or `parse`
 * @param {string} protocol - `sftp`, `ftp`, `http` or 's3'
 * @param {boolean} q - set to `true` to queue pdrs
 * @returns {function} - a constructor to create a PDR discovery object
 */
function selector(type, protocol, q) {
  if (type === 'discover') {
    switch (protocol) {
      case 'http':
        return q ? HttpDiscoverAndQueue : HttpDiscover;
      case 'ftp':
        return q ? FtpDiscoverAndQueue : FtpDiscover;
      case 'sftp':
        return q ? SftpDiscoverAndQueue : SftpDiscover;
      case 's3':
        return q ? S3DiscoverAndQueue : S3Discover;
      default:
        throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }
  else if (type === 'parse') {
    switch (protocol) {
      case 'http':
        return q ? HttpParseAndQueue : HttpParse;
      case 'ftp':
        return q ? FtpParseAndQueue : FtpParse;
      case 'sftp':
        return q ? SftpParseAndQueue : SftpParse;
      case 's3':
        return q ? S3ParseAndQueue : S3Parse;
      default:
        throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

module.exports.selector = selector;
module.exports.HttpParse = HttpParse;
module.exports.FtpParse = FtpParse;
module.exports.SftpParse = SftpParse;
module.exports.S3Parse = S3Parse;
module.exports.FtpDiscover = FtpDiscover;
module.exports.HttpDiscover = HttpDiscover;
module.exports.SftpDiscover = SftpDiscover;
module.exports.S3Discover = S3Discover;
module.exports.FtpDiscoverAndQueue = FtpDiscoverAndQueue;
module.exports.HttpDiscoverAndQueue = HttpDiscoverAndQueue;
module.exports.SftpDiscoverAndQueue = SftpDiscoverAndQueue;
module.exports.S3DiscoverAndQueue = S3DiscoverAndQueue;

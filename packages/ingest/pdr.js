'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const path = require('path');
const { CollectionConfigStore } = require('@cumulus/common');

const { baseProtocol } = require('./protocol');
const { ftpMixin } = require('./ftp');
const { httpMixin } = require('./http');
const { parsePdr } = require('./parse-pdr');
const { s3Mixin } = require('./s3');
const { sftpMixin } = require('./sftp');
const { normalizeProviderPath } = require('./util');


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
    providerPath,
    provider,
    useList = false,
    folder = 'pdrs',
    force = false
  ) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.stack = stack;
    this.bucket = bucket;
    this.provider = provider;
    this.folder = folder;
    this.useList = useList;
    this.force = force;

    // get authentication information
    this.port = get(this.provider, 'port');
    this.host = get(this.provider, 'host', null);
    this.path = normalizeProviderPath(providerPath);
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
  }

  /**
   * discover PDRs from an endpoint
   *
   * @returns {Promise} - resolves to new PDRs?
   * @public
   */
  async discover() {
    const files = await this.list();
    const pdrs = files.filter((file) => file.name.endsWith('.PDR'));

    if (this.force) {
      return pdrs;
    }

    return this.findNewPdrs(pdrs);
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
   * @param {Array} pdrs - list of pdr names (do not include the full path)
   * @returns {Object} newPdrs
   */
  async findNewPdrs(pdrs) {
    const checkPdrs = pdrs.map((pdr) => this.pdrIsNew(pdr));
    const _pdrs = await Promise.all(checkPdrs);

    const newPdrs = _pdrs.filter((p) => p);
    return newPdrs;
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
    provider,
    useList = false,
    folder = 'pdrs'
  ) {
    if (this.constructor === Parse) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.pdr = pdr;
    this.stack = stack;
    this.bucket = bucket;
    this.provider = provider;
    this.folder = folder;
    this.useList = useList;

    this.port = get(this.provider, 'port');
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
   * @returns {Promise<Object>} - the parsed PDR
   * @public
   */
  async ingest() {
    // download the PDR
    const downloadDir = await this.createDownloadDirectory();
    const pdrLocalPath = path.join(downloadDir, this.pdr.name);
    const pdrRemotePath = path.join(this.pdr.path, this.pdr.name);
    await this.download(pdrRemotePath, pdrLocalPath);

    let parsedPdr;
    try {
      // parse the PDR
      parsedPdr = await this.parse(pdrLocalPath);

      // upload only if the parse was successful
      await this.upload(
        this.bucket,
        path.join(this.stack, this.folder),
        this.pdr.name,
        pdrLocalPath
      );
    } finally {
      // Clean up the temporary download directory
      await fs.remove(downloadDir);
    }

    return parsedPdr;
  }

  /**
   * This method parses a PDR and returns all the granules in it
   *
   * @param {string} pdrLocalPath - PDR path on disk
   * @returns {Promise} the parsed PDR
   * @public
   */
  async parse(pdrLocalPath) {
    const collectionConfigStore = new CollectionConfigStore(this.bucket, this.stack);
    const parsed = await parsePdr(pdrLocalPath, collectionConfigStore, this.pdr.name);

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
 * Discover PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscover extends ftpMixin(baseProtocol(Discover)) {}

/**
 * Discover PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscover extends httpMixin(baseProtocol(Discover)) {}

/**
 * Discover PDRs from a SFTP endpoint.
 *
 * @class
 */

class SftpDiscover extends sftpMixin(baseProtocol(Discover)) {}

/**
 * Discover PDRs from a S3 endpoint.
 *
 * @class
 */
class S3Discover extends s3Mixin(baseProtocol(Discover)) {}

/**
 * Parse PDRs downloaded from a SFTP endpoint.
 *
 * @class
 */

class SftpParse extends sftpMixin(baseProtocol(Parse)) {}

/**
 * Parse and Queue PDRs downloaded from a FTP endpoint.
 *
 * @class
 */

class FtpParse extends ftpMixin(baseProtocol(Parse)) {}

/**
 * Parse and Queue PDRs downloaded from a HTTP endpoint.
 *
 * @class
 */

class HttpParse extends httpMixin(baseProtocol(Parse)) {}


/**
 * Parse PDRs downloaded from a S3 endpoint.
 *
 * @class
 */
class S3Parse extends s3Mixin(baseProtocol(Parse)) {}

/**
 * Select a class for discovering PDRs based on protocol
 *
 * @param {string} type - `discover` or `parse`
 * @param {string} protocol - `sftp`, `ftp`, `http` or 's3'
 * @returns {function} - a constructor to create a PDR discovery object
 */
function selector(type, protocol) {
  if (type === 'discover') {
    switch (protocol) {
    case 'http':
    case 'https':
      return HttpDiscover;
    case 'ftp':
      return FtpDiscover;
    case 'sftp':
      return SftpDiscover;
    case 's3':
      return S3Discover;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  } else if (type === 'parse') {
    switch (protocol) {
    case 'http':
    case 'https':
      return HttpParse;
    case 'ftp':
      return FtpParse;
    case 'sftp':
      return SftpParse;
    case 's3':
      return S3Parse;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

module.exports.selector = selector;
module.exports.Discover = Discover;
module.exports.Parse = Parse;
module.exports.FtpDiscover = FtpDiscover;
module.exports.FtpParse = FtpParse;
module.exports.HttpDiscover = HttpDiscover;
module.exports.HttpParse = HttpParse;
module.exports.S3Discover = S3Discover;
module.exports.S3Parse = S3Parse;
module.exports.SftpDiscover = SftpDiscover;
module.exports.SftpParse = SftpParse;

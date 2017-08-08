'use strict';

const path = require('path');
const get = require('lodash.get');
const urljoin = require('url-join');
const parsePdr = require('./parse-pdr').parsePdr;
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;
const uploadS3Files = require('@cumulus/common/aws').uploadS3Files;
const S3 = require('./aws').S3;

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class Discover {
  constructor(provider, bucket) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.bucket = bucket;
    this.port = get(provider, 'port', 21);
    this.host = get(provider, 'host', null);
    this.path = get(provider, 'path', '/');
    this.provider = provider;
    this.endpoint = urljoin(this.host, this.path);
    this.username = get(provider, 'username', null);
    this.password = get(provider, 'password', null);
  }

  /**
   * discover PDRs from an endpoint
   * @return {Promise}
   * @public
   */

  async discover() {
    const pdrs = await this._list();
    return this.findNewPdrs(pdrs);
  }

  async pdrIsNew(pdr) {
    const exists = await S3.fileExists(this.bucket, path.join('pdrs', pdr));
    return exists ? false : pdr;
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
    // check if any of the discovered PDRs exist on S3
    // return those that are missing
    const checkPdrs = pdrs.map(pdr => this.pdrIsNew(pdr));
    const _pdrs = await Promise.all(checkPdrs);

    const newPdrs = _pdrs.filter(p => p).map(p => ({
      pdrName: path.basename(p),
      pdrPath: path.dirname(p)
    }));
    return newPdrs;
  }
}


/**
 * This is a base class for ingesting and parsing a single PDR
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */

class Parse {
  constructor(pdr, provider, collections, bucket) {
    if (this.constructor === Parse) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.pdr = pdr;
    this.bucket = bucket;
    this.collections = collections; // holds the collections associated with the PDR
    this.port = get(provider, 'port', 21);
    this.host = get(provider, 'host', null);
    this.path = get(provider, 'path', '/');
    this.provider = provider;
    this.endpoint = urljoin(this.host, this.path);
    this.username = get(provider, 'username', null);
    this.password = get(provider, 'password', null);
  }

  /**
   * Copy the PDR to S3 and parse it
   *
   * @return {Promise}
   * @public
   */
  async ingest() {
    // push the PDR to S3
    const pdrLocalPath = await this.sync();

    // parse the PDR
    const granules = await this.parse(pdrLocalPath);

    // return list of all granules found in the PDR
    return granules;
  }

  /**
   * Download the PDR from the provider
   * upload it to S3 and return the path on the local machine
   *
   * @return {Promise}
   * @public
   */
  async sync() {
    // download the PDR
    const localPdrPath = await this._download(this.host, this.path, this.pdr);

    // upload to S3
    await uploadS3Files([localPdrPath], this.bucket, 'pdrs');

    return localPdrPath;
  }

  /**
   * This async method parse a PDR and returns all the granules in it
   *
   * @param {string} pdrLocalPath PDR path on disk
   * @return {Promise}
   * @public
   */

  async parse(pdrLocalPath) {
    // catching all parse errors here to mark the pdr as failed
    // if any error occured
    const parsed = parsePdr(pdrLocalPath, this.collections);

    // each group represents a Granule record.
    // After adding all the files in the group to the Queue
    // we create the granule record (moment of inception)
    console.log(`There are ${parsed.granulesCount} granules in ${this.pdr}`);
    console.log(`There are ${parsed.filesCount} files in ${this.pdr}`);

    return parsed;
  }
}

/**
 * Disocver PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscover extends ftpMixin(Discover) {}

/**
 * Parse PDRs downloaded from a FTP endpoint.
 *
 * @class
 */

class FtpParse extends ftpMixin(Parse) {}

/**
 * Disocver PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscover extends httpMixin(Discover) {}

/**
 * Parse PDRs downloaded from a HTTP endpoint.
 *
 * @class
 */

class HttpParse extends httpMixin(Parse) {}

module.exports.HttpParse = HttpParse;
module.exports.FtpParse = FtpParse;
module.exports.FtpDiscover = FtpDiscover;
module.exports.HttpDiscover = HttpDiscover;

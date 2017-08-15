'use strict';

const path = require('path');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const parsePdr = require('./parse-pdr').parsePdr;
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;
const S3 = require('./aws').S3;
const queue = require('./queue');

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class Discover {
  constructor(event) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = get(event, 'resources.buckets');
    this.collection = get(event, 'collection.meta');
    this.provider = get(event, 'provider');
    this.folder = get(event, 'meta.pdrFolder', 'pdrs');
    this.event = event;

    // get authentication information
    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.path = this.collection.provider_path || '/';
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
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

  async pdrIsNew(pdr) {
    const exists = await S3.fileExists(this.buckets.internal, path.join(this.folder, pdr.name));
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
    const checkPdrs = pdrs.map(pdr => this.pdrIsNew(pdr));
    const _pdrs = await Promise.all(checkPdrs);

    const newPdrs = _pdrs.filter(p => p);
    return newPdrs;
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
  async findNewPdrs(_pdrs) {
    let pdrs = _pdrs;
    pdrs = await super.findNewPdrs(pdrs);
    return Promise.all(pdrs.map(p => queue.queuePdr(this.event, p)));
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
  constructor(event) {
    if (this.constructor === Parse) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.event = event;
    this.pdr = get(event, 'payload.pdr');
    this.buckets = get(event, 'resources.buckets');
    this.collection = get(event, 'collection.meta');
    this.provider = get(event, 'provider');
    this.folder = get(event, 'meta.pdrFolder', 'pdrs');

    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);

    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
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

    // upload
    await this.upload(this.buckets.internal, this.folder, this.pdr.name, pdrLocalPath);

    // parse the PDR
    const granules = await this.parse(pdrLocalPath);

    // return list of all granules found in the PDR
    return granules;
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
    const parsed = parsePdr(pdrLocalPath, this.collection, this.pdr.name);

    // each group represents a Granule record.
    // After adding all the files in the group to the Queue
    // we create the granule record (moment of inception)
    log.info(`There are ${parsed.granulesCount} granules in ${this.pdr.name}`);
    log.info(`There are ${parsed.filesCount} files in ${this.pdr.name}`);

    return parsed;
  }
}

/**
 * This is a base class for discovering PDRs
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class ParseAndQueue extends Parse {
  async ingest() {
    const payload = await super.ingest();
    return Promise.all(payload.granules.map(g => queue.queueGranule(this.event, g)));
  }
}

/**
 * Disocver PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscover extends ftpMixin(Discover) {}

/**
 * Disocver PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscover extends httpMixin(Discover) {}

/**
 * Disocver PDRs from a FTP endpoint.
 *
 * @class
 */

class FtpDiscoverAndQueue extends ftpMixin(DiscoverAndQueue) {}

/**
 * Disocver PDRs from a HTTP endpoint.
 *
 * @class
 */

class HttpDiscoverAndQueue extends httpMixin(DiscoverAndQueue) {}

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
 * Parse PDRs downloaded from a FTP endpoint.
 *
 * @class
 */

class FtpParseAndQueue extends ftpMixin(ParseAndQueue) {}

/**
 * Parse PDRs downloaded from a HTTP endpoint.
 *
 * @class
 */

class HttpParseAndQueue extends httpMixin(ParseAndQueue) {}



function selector(type, protocol, q) {
  if (type === 'discover') {
    switch (protocol) {
      case 'http':
        return q ? HttpDiscoverAndQueue : HttpDiscover;
      case 'ftp':
        return q ? FtpDiscoverAndQueue : FtpDiscover;
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
      default:
        throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

module.exports.selector = selector;
module.exports.HttpParse = HttpParse;
module.exports.FtpParse = FtpParse;
module.exports.FtpDiscover = FtpDiscover;
module.exports.HttpDiscover = HttpDiscover;
module.exports.FtpDiscoverAndQueue = FtpDiscoverAndQueue;
module.exports.HttpDiscoverAndQueue = HttpDiscoverAndQueue;

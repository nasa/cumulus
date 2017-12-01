'use strict';

const path = require('path');
const get = require('lodash.get');
const logger = require('./log');
const { MismatchPdrCollection } = require('@cumulus/common/errors');
const parsePdr = require('./parse-pdr').parsePdr;
const ftpMixin = require('./ftp').ftpMixin;
const httpMixin = require('./http').httpMixin;
const { S3 } = require('./aws');
const queue = require('./queue');

const log = logger.child({ file: 'ingest/pdr.js' });

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

    const config = get(event, 'config');
    this.buckets = get(config, 'stack');
    this.buckets = get(config, 'buckets');
    this.collection = get(config, 'collection.meta');
    this.provider = get(config, 'provider');
    this.folder = get(config, 'pdrFolder', 'pdrs');
    this.event = event;

    // get authentication information
    this.port = get(this.provider, 'port', 21);
    this.host = get(this.provider, 'host', null);
    this.path = this.collection.provider_path || '/';
    this.username = get(this.provider, 'username', null);
    this.password = get(this.provider, 'password', null);
    this.limit = get(config, 'queueLimit', null);
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
    const exists = await S3.fileExists(this.buckets.internal, path.join(this.stack, this.folder, pdr.name));
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
    if (this.limit) {
      pdrs = pdrs.slice(0, this.limit);
    }
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

    const config = get(event, 'config');
    const input = get(event, 'input');

    this.pdr = get(input, 'pdr');
    this.stack = get(config, 'stack');
    this.buckets = get(config, 'buckets');
    this.collection = get(config, 'collection.meta');
    this.provider = get(config, 'provider');
    this.folder = get(config, 'pdrFolder', 'pdrs');

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
      this.buckets.internal,
      path.join(this.stack, this.folder),
      this.pdr.name,
      pdrLocalPath
    );

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
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class ParseAndQueue extends Parse {
  async ingest() {
    const payload = await super.ingest();
    const events = {};

    //payload.granules = payload.granules.slice(0, 10);

    // make sure all parsed granules have the correct collection
    for (const g of payload.granules) {
      if (!events[g.dataType]) {
        events[g.dataType] = JSON.parse(JSON.stringify(this.event));

        // if the collection is not provided in the payload
        // get it from S3
        if (g.dataType !== this.collection.name) {
          const bucket = this.buckets.internal;
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

          events[g.dataType].collection = {
            id: g.dataType,
            meta: JSON.parse(file.Body.toString())
          };
        }
      }

      g.granuleId = this.extractGranuleId(
        g.files[0].name,
        events[g.dataType].collection.meta.granuleIdExtraction
      );
    }

    log.info(`Queueing ${payload.granules.length} granules to be processed`);

    const names = await Promise.all(
      payload.granules.map(g => queue.queueGranule(events[g.dataType], g))
    );

    let isFinished = false;
    const running = names.filter(n => n[0] === 'running').map(n => n[1]);
    const completed = names.filter(n => n[0] === 'completed').map(n => n[1]);
    const failed = names.filter(n => n[0] === 'failed').map(n => n[1]);
    if (running.length === 0) {
      isFinished = true;
    }

    return { running, completed, failed, isFinished };
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

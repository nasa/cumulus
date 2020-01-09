'use strict';

const aws = require('@cumulus/common/aws');
const get = require('lodash.get');
const path = require('path');
const { buildProviderClient } = require('./providerClientUtils');
const { normalizeProviderPath } = require('./util');

class PdrDiscoverer {
  constructor(
    stack,
    bucket,
    providerPath,
    provider,
    useList = false,
    folder = 'pdrs',
    force = false
  ) {
    this.stack = stack;
    this.bucket = bucket;
    this.folder = folder;
    this.force = force;

    this.providerClient = buildProviderClient({
      ...provider,
      path: normalizeProviderPath(providerPath),
      useList
    });
  }

  connected() {
    return get(this.providerClient, 'connected', false);
  }

  end() {
    return this.providerClient.end ? this.providerClient.end() : undefined;
  }

  /**
   * discover PDRs from an endpoint
   *
   * @returns {Promise} - resolves to new PDRs?
   * @public
   */
  async discover() {
    const files = await this.providerClient.list();
    const pdrs = files.filter((file) => file.name.toUpperCase().endsWith('.PDR'));

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

module.exports = PdrDiscoverer;

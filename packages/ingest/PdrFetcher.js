'use strict';

const aws = require('@cumulus/common/aws');
const fs = require('fs-extra');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const os = require('os');
const path = require('path');
const { CollectionConfigStore } = require('@cumulus/common');
const { parsePdr } = require('./parse-pdr');
const { buildProviderClient } = require('./providerClientUtils');

const upload = async (bucket, key, filename, tempFile) => {
  let fullKey = path.join(key, filename);

  // handle the edge case where leading / in key creates incorrect path
  // by remove the first slash if it exists
  if (fullKey[0] === '/') {
    fullKey = fullKey.substr(1);
  }

  await aws.s3PutObject({
    Bucket: bucket,
    Key: fullKey,
    Body: fs.createReadStream(tempFile)
  });

  const s3Uri = `s3://${bucket}/${fullKey}`;
  log.info(`uploaded ${s3Uri}`);

  return s3Uri;
};

class PdrFetcher {
  constructor(
    pdr,
    stack,
    bucket,
    provider,
    useList = false,
    folder = 'pdrs'
  ) {
    this.pdr = pdr;
    this.stack = stack;
    this.bucket = bucket;
    this.folder = folder;

    this.providerClient = buildProviderClient({
      ...provider,
      useList
    });
  }

  connected() {
    return get(this.providerClient, 'connected', false);
  }

  end() {
    return this.providerClient.end ? this.providerClient.end() : undefined;
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
    const downloadDir = await fs.mkdtemp(`${os.tmpdir()}${path.sep}`);
    const pdrLocalPath = path.join(downloadDir, this.pdr.name);
    const pdrRemotePath = path.join(this.pdr.path, this.pdr.name);
    await this.providerClient.download(pdrRemotePath, pdrLocalPath);

    let parsedPdr;
    try {
      // parse the PDR
      parsedPdr = await this.parse(pdrLocalPath);

      // upload only if the parse was successful
      await upload(
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

module.exports = PdrFetcher;

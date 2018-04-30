'use strict';

const log = require('@cumulus/common/log');
const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const mkdirp = require('mkdirp');

/**
 * Copy IDX file from S3 to target directory
 *
 * @param {string} dirname - Target Directory Name
 * @param {Hash} payload - Payload from previous task
 * @returns {boolean} true
 */
const copyIdx = async (dirname, payload) => {
  // Make sure the target directory exists
  if (!fs.existsSync(dirname)) {
    try {
      mkdirp.sync(dirname);
    }
    catch (e) {
      log.error(`copyIdx mkdirp exception ${e}`);
      throw e;
    }
  }

  for (const p of payload) {
    const bucket = p.Bucket;
    const key = p.Key;

    if (key.indexOf('.idx') > 0) {
      const basename = path.basename(key);
      const idxFilename = path.join(dirname, basename);
      const outFilename = idxFilename.replace('.tgz', '');
      log.info(`Downloading ${idxFilename} from S3 ${bucket}/${key}...`);

      await aws.downloadS3File(p, idxFilename);

      if (idxFilename.indexOf('.tgz') > 0) {
        log.info(`Decompressing ${idxFilename}...`);

        // Decompress the file
        const ls = spawn('tar', ['-xzf', idxFilename, '--strip=1', '-C', dirname]);

        ls.on('close', (code) => {
          if (code !== 0) {
            throw new Error(`tar exited with code ${code} untared to ${dirname}`);
          }
          else {
            fs.renameSync(path.join(dirname, 'out.idx'), outFilename);
            log.info(`Created idx file: ${outFilename}`);

            fs.unlinkSync(idxFilename);
            log.info(`Deleted ${idxFilename}`);
          }
        });
      }
      else {
        log.info(`${idxFilename} is not a .tgz file - no decompression needed`);
      }
    }
  }
  return true;
};

/**
 * Task to copy idx file from S3 to EFS.
 * Input payload: An S3 object
 * Input config: target EFS directory
 * Output payload: No change to payload.
 */
module.exports = class CopyIdxFileToS3Task extends Task {

  /**
   * Main task entry point
   *
   * @returns {Hash} same message payload
   */
  async run() {
    const config = this.config;
    const payload = this.message.payload;
    const dirname = config.dirname;

    if (!dirname) {
      throw new Error('Undefined directory name');
    }

    if (!payload || payload.length === 0) {
      log.info('No files to copy');
    }
    else {
      await copyIdx(dirname, payload);
    }
    return payload;
  }

  /**
   * Entry point for Lambda
   *
   * @param {Array} args - The arguments passed by AWS Lambda
   * @returns {Hash} The handler return value
   */
  static handler(...args) {
    return CopyIdxFileToS3Task.handle(...args);
  }
};

// Testing in Visual Studio Code

//global.__isDebug = true;
//const payload = require('@cumulus/test-data/payloads/payload_ast_l1t_ll.json');
//const local = require('@cumulus/common/local-helpers');
//const localTaskName = 'CopyIdxFromS3';
//const configFile = path.join(__dirname, './test/ast_l1t.yml');

//local.setupLocalRun(module.exports.handler, local.collectionMessageInput(
//  'AST_L1T_DAY', localTaskName, () => payload, configFile));

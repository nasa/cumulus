'use strict';

const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;

const Task = require('@cumulus/common/task');
const log = require('@cumulus/common/log');
const util = require('@cumulus/common/util');
const aws = require('@cumulus/common/aws');
const configGen = require('./config-gen');
const Mutex = require('@cumulus/common/concurrency').Mutex;

const LOCK_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const execSync = require('child_process').execSync;


module.exports = class GenerateMrfTask extends Task {
  run() {
    const mutex = new Mutex(aws.dynamodbDocClient(), this.message.resources.tables.locks);
    return mutex.lock(this.message.meta.key, LOCK_TIMEOUT_MS, this.runWithLock.bind(this));
  }

  async runWithLock() {
    const message = this.message;

    if (message.payload.length === 0) {
      log.info('No files to process');
      return [];
    }
    const tempDir = util.mkdtempSync(this.constructor.name);

    try {
      const paths = {
        mrfgenConfig: path.join(tempDir, 'mrfgenConfig.xml'),
        templates: path.join(__dirname, 'templates')
      };

      for (const tempPath of ['work', 'input', 'output', 'logs', 'emptyTiles']) {
        paths[tempPath] = path.join(tempDir, tempPath);
        if (!fs.existsSync(paths[tempPath])) {
          fs.mkdirSync(paths[tempPath]);
        }
      }

      const emptyTileSrcDir = path.join(paths.templates, 'empty-tiles');
      fs.readdirSync(emptyTileSrcDir).forEach((tilefile) => {
        fs.linkSync(path.join(emptyTileSrcDir, tilefile),
          path.join(paths.emptyTiles, tilefile));
      });

      const mrfConfig = configGen.generateConfig(
        `EPSG:${this.config.epsg}`,
        this.config.date,
        this.config.zoom,
        this.config.mrfgen,
        paths
      );

      const destBucket = this.config.output.bucket;
      const destKey = this.config.output.key_prefix;

      log.info("Writing mrfgen config", mrfConfig);
      fs.writeFileSync(paths.mrfgenConfig, mrfConfig, {
        mode: 0o600
      });

      for (const file of (this.config.files || [])) {
        if (file.filename) {
          const name = file.filename || path.basename(file.Key);
          const fullpath = path.join(paths.input, name);
          fs.writeFileSync(fullpath, file.contents, { mode: 0o600 });
        }
        else {
          await aws.downloadS3Files([file], paths.input);
        }
      }

      const messageInfo = `(${message.payload.length} files from ${this.message.meta.key})`;
      await aws.downloadS3Files(message.payload, paths.input);
      log.info(`Completed source download ${messageInfo}`);
      log.info('==== MRF CONFIG ====');
      log.info(mrfConfig);
      log.info('========');
      await this.runMrfgen(paths.mrfgenConfig);
      log.info(`Completed MRF generation ${messageInfo}`);
      const fullPaths = fs.readdirSync(paths.output).map((f) => path.join(paths.output, f));
      // Upload under the destKey bucket, inserting an underscore before the file extension
      const destKeyFn = (filename) =>
        path.join(destKey, path.basename(filename).replace(/\.([^\.]*)$/, '_.$1'));
      await aws.uploadS3Files(fullPaths, destBucket, destKeyFn);
    }
    finally {
      execSync(`rm -rf ${tempDir}`);
    }
  }

  runMrfgen(configPath) {
    log.info(`==== ${configPath} ====`);
    spawnSync('cat', [configPath], { stdio: 'inherit' });
    log.info('========');
    return new Promise((resolve, reject) => {
      const mrfgen = spawn('mrfgen', ['-c', configPath], {
        stdio: 'inherit',
        shell: true
      });
      mrfgen.on('close', (code) => {
        if (code === 0) {
          resolve(configPath);
        }
        else {
          reject(`mrfgen exited with code ${code}`);
        }
      });
    });
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return GenerateMrfTask.handle(...args);
  }
};


global.__isDebug = true;
const local = require('@cumulus/common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { message_source: 'stdin', task: 'MRFGen' } }));

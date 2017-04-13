'use strict';

const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const spawnSync = require('child_process').spawnSync;

const Task = require('gitc-common/task');
const log = require('gitc-common/log');
const util = require('gitc-common/util');
const aws = require('gitc-common/aws');
const configGen = require('./config-gen');

const LOCK_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const execSync = require('child_process').execSync;


module.exports = class GenerateMrfTask extends Task {
  run() {
    return this.exclusive(this.event.meta.key, LOCK_TIMEOUT_MS, this.runExclusive.bind(this));
  }

  async runExclusive() {
    const event = this.event;

    log.info(this.config);
    log.info(this.event.meta);

    //log.info(JSON.stringify(event));

    if (event.payload.length === 0) {
      log.info('No files to process');
      return this.complete(Object.assign({}, event, {
        files: []
      }));
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

      const destBucket = this.config.output.Bucket;
      const destKey = this.config.output.Key;

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

      const eventInfo = `(${event.payload.length} files from ${this.event.meta.key})`;
      await aws.downloadS3Files(event.payload, paths.input);
      this.logStageComplete(`Source Download ${eventInfo}`);
      log.info('==== MRF CONFIG ====');
      log.info(mrfConfig);
      log.info('========');
      await this.runMrfgen(paths.mrfgenConfig);
      this.logStageComplete(`MRF Generation ${eventInfo}`);
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

  static handler(...args) {
    return GenerateMrfTask.handle(...args);
  }
};


const local = require('gitc-common/local-helpers');
local.setupLocalRun(
  module.exports.handler,
  () => ({ ingest_meta: { event_source: 'stdin', task: 'MRFGen' } }));

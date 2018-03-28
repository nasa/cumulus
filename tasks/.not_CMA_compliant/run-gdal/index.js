'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;

/**
 *
 */
module.exports = class RunGdalTask extends Task {
  /**
   * Main task entrypoint
   * @return A payload suitable for syncing via http url sync
   */
  async run() {
    const config = this.config;
    const payload = this.message.payload;

    let files = [];
    if (Array.isArray(payload)) {
      files = files.concat(payload);
    }
    else if (payload) {
      files.push(payload);
    }
    if (config.additional_files) {
      files = files.concat(config.additional_files);
    }
    if (files.length > config.input_filenames.length) {
      throw new Error('input_filenames do not provide enough values for input files');
    }
    const downloads = files.map((s3file, i) =>
      aws.downloadS3File(s3file, path.join('/tmp', config.input_filenames[i]))
    );

    await Promise.all(
      downloads.concat(
        this.promiseSpawn('mkdir', ['-p', 'in', 'out', 'work', 'logs'])));

    for (const command of config.commands) {
      await this.runGdalCommand(command.gdal_command, command.args);
    }

    const outputPromises = config.outputs.map((output) => this.compressAndUploadOutput(output));

    const result = await Promise.all(outputPromises);
    return result.map((obj) => ({ Key: obj[0].key, Bucket: obj[0].bucket }));
  }

  /**
   * Uploads a file from the configuration to S3, compressing if requested
   * @param {Object} output The output file, as configured
   */
  async compressAndUploadOutput(output) {
    let filename = output.filename;
    if (output.compress) {
      filename = `${filename}.tgz`;
      await this.promiseSpawn('tar', ['cvpzfS', filename, output.filename]);
    }

    return aws.uploadS3Files([{
      filename: path.join('/tmp', filename),
      bucket: output.dest.Bucket,
      key: output.dest.Key
    }]);
  }

  /**
   * Runs the given GDAL command and arguments (as defined in the task config), validating the
   * command is valid first
   * @param {String} command The name of the gdal command to run, e.g. "gdalinfo"
   * @param {Array<string>} args An array of string arguments to pass to the gdal command
   */
  runGdalCommand(command, args) {
    const program = path.resolve(process.cwd(), 'bin', command);
    if (!command.match(/^[a-z0-9\-_\.]+$/g) || !fs.existsSync(program)) {
      if (!fs.existsSync(program)) {
        throw new Error(`No such program: ${program} (dir: ${__dirname}, cwd: ${process.cwd()})`);
      }
      throw new Error(`Invalid gdal_command: ${command}`);
    }
    return this.promiseSpawn(program, args);
  }

  /**
   * Invokes the given program with the given args, returning a promise that resolves / rejects
   * according to the return value of the invocation. A successful promise resolves to 0
   * @param {String} program The program to spawn
   * @param {Array<String>} args The command line arguments to pass to the program
   */
  promiseSpawn(program, args) {
    log.info(`Spawning: ${program} "${args.join('", "')}"`);
    const proc = spawn(program, args || [], {
      stdio: 'inherit',
      cwd: '/tmp',
      env: {
        PYTHONPATH: path.resolve(process.cwd(), 'lib64/python2.7/site-packages/'),
        LD_LIBRARY_PATH: path.resolve(process.cwd(), 'lib'),
        PATH: [process.env.PATH, path.resolve(process.cwd(), 'bin')].join(':')
      }
    });
    return new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(0);
        }
        else {
          const error = new Error(`Process exited with code ${code}`);
          error.code = code;
          reject(error);
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
    return RunGdalTask.handle(...args);
  }
};

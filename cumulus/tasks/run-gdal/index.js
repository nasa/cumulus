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
    await Promise.all(downloads);

    for (const command of config.commands) {
      await this.runGdalCommand(command.gdal_command, command.args);
    }

    const outputPromises = config.outputs.map((output) => this.compressAndUploadOutput(output));

    return await Promise.all(outputPromises);
  }

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
    if (!command.match(/^[a-z0-9\-_]+$/g) || !fs.existsSync(program)) {
      if (!fs.existsSync(program)) {
        throw new Error(`this happened: ${__dirname}, ${program}`);
      }
      throw new Error(`Invalid gdal_command: ${command}`);
    }
    return this.promiseSpawn(program, args);
  }

  promiseSpawn(program, args) {
    log.info(`Spawning: ${program} "${args.join('", "')}"`);
    const process = spawn(program, args || [], { stdio: 'inherit', cwd: '/tmp' });
    return new Promise((resolve, reject) => {
      process.on('close', (code) => {
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

'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const fs = require('fs');
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

    const filename = this.config.input_filename;
    const { bucket, key } = Array.isArray(payload) ? payload[0] : payload;
    await aws.downloadS3File({ Bucket: bucket, Key: key }, filename);

    for (const command of config.commands) {
      await this.runGdalCommand(command.gdal_command, command.args);
    }

    const outputs = config.outputs.map((out) => ({
      filename: out.filename,
      bucket: out.dest.bucket,
      key: out.dest.key
    }));

    return await aws.uploadS3Files(outputs);
  }

  /**
   * Runs the given GDAL command and arguments (as defined in the task config), validating the command is valid first
   * @param {String} command The name of the gdal command to run, e.g. "gdalinfo"
   * @param {Array<string>} args An array of string arguments to pass to the gdal command
   */
  runGdalCommand(command, args) {
    const program = `bin/${command}`;
    if (!program.match(/^bin\/[a-z0-9\-_]+$/g) || !fs.existsSync(program)) {
      throw new Error(`Invalid gdal_command: ${command}`);
    }
    const process = spawn(program, args || [], { stdio: 'inherit' });
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

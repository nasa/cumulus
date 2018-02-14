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
   * Compute the minimum bounding rectangle for the given polygon. Assumes the maximum
   * longitudinal distance * between points is less than 180 degrees.
   * NOTE: This will NOT work for polygons covering poles.
   * @param {string} polyString  A polygon from a CMR metadata response. See #splitPolygonAtAntimeridian
   * @returns {Array} An array containing the mbr in the form [latBL, lonBL, latUR, lonRU] where
   * latBL = latitude of the bottom left corner
   * lonBL = longitude of the bottom left corner
   * latUR = latitude of the upper right corner
   * lonUR = longitude of the upper right corner
   */
  static mbr(polyString) {
    const coords = polyString.split(' ');
    let minLat = 360.0;
    let minLon = 360.0;
    let maxLat = -360.0;
    let maxLon = -360.0;
    for (let i = 1; i < coords.length / 2; i++) {
      const lat = parseFloat(coords[i * 2]);
      const lon = parseFloat(coords[(i * 2) + 1]);

      if (lon > maxLon) maxLon = lon;
      if (lon < minLon) minLon = lon;
      if (lat > maxLat) maxLat = lat;
      if (lat < minLat) minLat = lat;
    }

    if (maxLon - minLon > 180.0) {
      const tmp = minLon;
      minLon = maxLon;
      maxLon = tmp;
    }

    return [minLat, minLon, maxLat, maxLon];
  }

  /**
   *
   * - @param {string} polyStirng A polygon from a CMR metadata response. See #splitPolygonAtAntimeridian
   */
  static doesCrossAntimeridian(polyString) {
    let doesCross = false;
    const coords = polyString.split(' ');
    let prevLon = parseFloat(coords[1]);
    for (let i = 1; i < coords.length / 2; i++) {
      const lon = parseFloat(coords[(i * 2) + 1]);
      if (prevLon - lon > 0) {
        doesCross = true;
        break;
      }
      prevLon = lon;
    }

    return doesCross;
  }

  /**
   *
   * @param {string} polyString A polygon from a CMR metadata response. This has the form
   * "lat_0 lon_0 lat_1 lon_1 ... lat_n lon_n lat_0 lon_0"
   *
   * Note that the first and last point must be the same.
   */
  static splitPolygonAtAntimeridian(polyString) {
    const leftPoly = [];
    const rightPoly = [];

    const ords = polyString.split(' ');
    for (let i = 0; i < ords.length / 2; i++) {
      // const lon =
    }

    return [leftPoly, rightPoly];
  }

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

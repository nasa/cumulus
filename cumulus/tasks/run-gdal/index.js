'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');
const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const rimraf = require('rimraf');

/**
 *
 */
module.exports = class RunGdalTask extends Task {

  /**
   * Compute the minimum bounding rectangle (MBR) for the given polygon. Assumes the maximum
   * longitudinal distance * between points is less than 180 degrees.
   * NOTE: This will NOT work for polygons covering poles.
   * @param {string} polyString  A polygon from a CMR metadata response. This has the form
   * "lat_0 lon_0 lat_1 lon_1 ... lat_n lon_n lat_0 lon_0"
   * @returns {Array} An array containing the mbr in the form [latBL, lonBL, latUR, lonRU] where
   * latBL = latitude of the bottom left corner
   * lonBL = longitude of the bottom left corner
   * latUR = latitude of the upper right corner
   * lonUR = longitude of the upper right corner
   */
  static computeMbr(polyString) {
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
   * Main task entrypoint
   * @return A payload suitable for syncing via http url sync
   */
  async run() {
    const config = this.config;
    const payload = this.message.payload;
    const meta = this.message.meta;
    let polygons = meta.polygons;
    if (polygons) {
      polygons = JSON.parse(polygons);
    }

    // If a bounding box was specified use that instead of computing an mbr
    let box = meta.box !== '{granule.box}' ? meta.box : null;

    // create a list of the files to download from S3 based on the payload contents
    let files = [];
    if (Array.isArray(payload)) {
      files = files.concat(payload);
    }
    else if (payload) {
      files.push(payload);
    }
    // Add any additional files to the file list to be downloaded - these are config files
    // and what not that are the same for every execution of run-gdal. These are kept
    // in S3 so they can be downloaded when this task is run.
    if (config.additional_files) {
      files = files.concat(config.additional_files);
    }
    // We are going to copy things from S3 to be processed on our local lambda file system.
    // The local files will be named with the names given in our configuration (this allows
    // the gdal command arguments to be statically defined in the config and still work, e.g.,
    // the input file will always be named 'input'). The following line is a sanity check to make
    // sure we have defined a local file name for everything we will download from S3.
    if (files.length > config.input_filenames.length) {
      throw new Error('input_filenames do not provide enough values for input files');
    }
    // Download everything from S3 and give them the configured file names on the local file system.
    const downloads = files.map((s3file, i) =>
      aws.downloadS3File(s3file, path.join('/tmp', config.input_filenames[i]))
    );

    await Promise.all(
      downloads.concat(
        this.promiseSpawn('mkdir', ['-p', 'in', 'out', 'work', 'logs'])));

    // XXX Ideally this code should just execute the gdal commands that have been configured,
    // but images crossing the anti-meridian (see GITC-567) need to be split before being
    // processed and then merged together. This specific check makes this implementation less
    // generic than it had been previously.

    let [latBL, lonBL, latUR, lonUR] = box || RunGdalTask.computeMbr(polygons[0][0]);
    if (lonBL > 0 && lonUR < 0) {
      // crosses the anti-meridian
      log.info("Splitting granule at the anti-meridian");
      const leftLon = 179.999;
      const rightLon = 180.001;

      // change -180 to 0 to 180 to 360
      lonUR = 360.0 + lonUR;

      const leftCoords = [[lonBL, latBL], [leftLon, latBL], [leftLon, latUR], [lonBL, latUR], [lonBL, latBL]];
      const rightCoords = [[rightLon, latBL], [lonUR, latBL], [lonUR, latUR], [rightLon, latUR], [rightLon, latBL]];

      const leftMap = { type: 'Polygon', coordinates: [leftCoords] };
      const rightMap = { type: 'Polygon', coordinates: [rightCoords] };

      fs.writeFileSync('/tmp/left_side_cmr.json', JSON.stringify(leftMap));
      fs.writeFileSync('/tmp/right_side_cmr.json', JSON.stringify(rightMap));

      // DEBUG
      let contents = fs.readFileSync('/tmp/left_side_cmr.json').toString();
      log.info("LEFT GeoJSON FILE CONTENTS:");
      log.info(contents);

      contents = fs.readFileSync('/tmp/right_side_cmr.json').toString();
      log.info("RIGHT GeoJSON FILE CONTENTS:");
      log.info(contents);

      for (const command of config.alternate_commands) {
        await this.runGdalCommand(command.gdal_command, command.args);
      }
    }
    else {
      for (const command of config.commands) {
        await this.runGdalCommand(command.gdal_command, command.args);
      }
    }

    const outputPromises = config.outputs.map((output) => this.compressAndUploadOutput(output));

    const result = await Promise.all(outputPromises);

    // clean up the directory where images are stored to prevent conlicts between lambda
    // invocations
    log.info('Removing /tmp/in directory');
    rimraf('/tmp/in', () => log.info('Removed /tmp/in'))


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

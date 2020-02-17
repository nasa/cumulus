'use strict';

const encodeurl = require('encodeurl');
const errors = require('@cumulus/errors');
const get = require('lodash.get');
const moment = require('moment');
const S3 = require('@cumulus/aws-client/S3');
const { log } = require('@cumulus/common');

/**
* Copy granule file from one s3 bucket & keypath to another
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} options - optional object with properties as defined by AWS API:
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-property
* @returns {Promise} returms a promise that is resolved when the file is copied
**/
function copyGranuleFile(source, target, options = {}) {
  const CopySource = encodeurl(`${source.Bucket}/${source.Key}`);

  const params = {
    CopySource,
    Bucket: target.Bucket,
    Key: target.Key,
    ...options
  };

  return S3.s3CopyObject(params)
    .catch((error) => {
      log.error(`Failed to copy s3://${CopySource} to s3://${target.Bucket}/${target.Key}: ${error.message}`);
      throw error;
    });
}

/**
* Move granule file from one s3 bucket & keypath to another
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} options - optional object with properties as defined by AWS API:
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-prop
* @returns {Promise} returns a promise that is resolved when the file is moved
**/
async function moveGranuleFile(source, target, options) {
  await copyGranuleFile(source, target, options);
  return S3.deleteS3Object(source.Bucket, source.Key);
}

/**
* Move granule file from one s3 bucket & keypath to another,
* creating a versioned copy of any file already existing at the target location
* and returning an array of the moved file and all versioned filenames.
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} sourceChecksumObject - source checksum information
* @param {string} sourceChecksumObject.checksumType - checksum type, e.g. 'md5'
* @param {Object} sourceChecksumObject.checksum - checksum value
* @param {Object} copyOptions - optional object with properties as defined by AWS API:
* https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#copyObject-prop
* @returns {Promise<Array>} returns a promise that resolves to a list of s3 version file objects.
**/
async function moveGranuleFileWithVersioning(source, target, sourceChecksumObject, copyOptions) {
  const { checksumType, checksum } = sourceChecksumObject;
  // compare the checksum of the existing file and new file, and handle them accordingly
  const targetFileSum = await S3.calculateS3ObjectChecksum(
    { algorithm: (checksumType || 'CKSUM'), bucket: target.Bucket, key: target.Key }
  );
  const sourceFileSum = checksum || await S3.calculateS3ObjectChecksum(
    { algorithm: 'CKSUM', bucket: source.Bucket, key: source.Key }
  );

  // if the checksum of the existing file is the same as the new one, keep the existing file,
  // else rename the existing file, and both files are part of the granule.
  if (targetFileSum === sourceFileSum) {
    await S3.deleteS3Object(source.Bucket, source.Key);
  } else {
    log.debug(`Renaming ${target.Key}...`);
    await exports.renameS3FileWithTimestamp(target.Bucket, target.Key);
    await exports.moveGranuleFile(
      { Bucket: source.Bucket, Key: source.Key },
      { Bucket: target.Bucket, Key: target.Key },
      copyOptions
    );
  }
  // return renamed files
  return exports.getRenamedS3File(target.Bucket, target.Key);
}

/**
 * handle duplicate file in S3 syncs and moves
 *
 * @param {Object} params - params object
 * @param {Object} params.source - source object: { Bucket, Key }
 * @param {Object} params.target - target object: { Bucket, Key }
 * @param {Object} params.copyOptions - s3 CopyObject() options
 * @param {string} params.duplicateHandling - duplicateHandling config string
 * One of [`error`, `skip`, `replace`, `version`].
 * @param {Function} [params.checksumFunction] - optional function to verify source & target:
 * Called as `await checksumFunction(bucket, key);`, expected to return array where:
 * array[0] - string - checksum type
 * array[1] - string - checksum value
 * For example of partial application of expected values see `ingestFile` in this module.
 * @param {Function} [params.syncFileFunction] - optional function to sync file from non-s3 source.
 * Syncs to temporary source location for `version` case and to target location for `replace` case.
 * Called as `await syncFileFunction(bucket, key);`, expected to create file on S3.
 * For example of function prepared with partial application see `ingestFile` in this module.
 * @throws {DuplicateFile} DuplicateFile error in `error` case.
 * @returns {Array<Object>} List of file version S3 Objects in `version` case, otherwise empty.
 */
async function handleDuplicateFile({
  source,
  target,
  copyOptions,
  duplicateHandling,
  checksumFunction,
  syncFileFunction
}) {
  if (duplicateHandling === 'error') {
    // Have to throw DuplicateFile and not WorkflowError, because the latter
    // is not treated as a failure by the message adapter.
    throw new errors.DuplicateFile(`${target.Key} already exists in ${target.Bucket} bucket`);
  } else if (duplicateHandling === 'version') {
    // sync to staging location if required
    if (syncFileFunction) await syncFileFunction(source.Bucket, source.Key);
    let sourceChecksumObject = {};
    if (checksumFunction) {
      // verify integrity
      const [checksumType, checksum] = await checksumFunction(source.Bucket, source.Key);
      sourceChecksumObject = { checksumType, checksum };
    }
    // return list of renamed files
    return moveGranuleFileWithVersioning(
      source,
      target,
      sourceChecksumObject,
      copyOptions
    );
  } else if (duplicateHandling === 'replace') {
    if (syncFileFunction) {
      // sync directly to target location
      await syncFileFunction(target.Bucket, target.Key);
    } else {
      await moveGranuleFile(source, target, copyOptions);
    }
    // verify integrity after sync/move
    if (checksumFunction) await checksumFunction(target.Bucket, target.Key);
  }
  // 'skip' and 'replace' returns
  return [];
}

/**
 * For each source file, see if there is a destination and generate the source
 * and target for the file moves.
 * @param {Array<Object>} sourceFiles - granule file objects
 * @param {Array<Object>} destinations - array of objects defining the destination of granule files
 * @returns {Array<Object>} - array containing the parameters for moving the file:
 *  {
 *    source: { Bucket, Key },
 *    target: { Bucket, Key },
 *    file: file object
 *  }
 */
function generateMoveFileParams(sourceFiles, destinations) {
  return sourceFiles.map((file) => {
    const fileName = file.name || file.fileName;
    const destination = destinations.find((dest) => fileName.match(dest.regex));

    // if there's no match, we skip the file
    if (!destination) return { source: null, target: null, file };

    let source;
    if (file.bucket && file.key) {
      source = {
        Bucket: file.bucket,
        Key: file.key
      };
    } else if (file.filename) {
      source = S3.parseS3Uri(file.filename);
    } else {
      throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
    }

    const getFileName = (f) => f.fileName || f.name;

    const targetKey = destination.filepath
      ? `${destination.filepath}/${getFileName(file)}`
      : getFileName(file);

    const target = {
      Bucket: destination.bucket,
      Key: targetKey
    };

    return { source, target, file };
  });
}

/**
 * Moves granule files from one S3 location to another.
 *
 * @param {Array<Object>} sourceFiles - array of file objects, they are updated with destination
 * location after the files are moved
 * @param {string} sourceFiles.name - file name
 * @param {string} sourceFiles.bucket - current bucket of file
 * @param {string} sourceFiles.key - current S3 key of file
 * @param {Array<Object>} destinations - array of objects defining the destination of granule files
 * @param {string} destinations.regex - regex for matching filepath of file to new destination
 * @param {string} destinations.bucket - aws bucket of the destination
 * @param {string} destinations.filepath - file path/directory on the bucket for the destination
 * @returns {Promise<Array>} returns array of source files updated with new locations.
 */
async function moveGranuleFiles(sourceFiles, destinations) {
  const moveFileParams = generateMoveFileParams(sourceFiles, destinations);

  const processedFiles = [];
  const moveFileRequests = moveFileParams.map((moveFileParam) => {
    const { source, target, file } = moveFileParam;

    if (target) {
      log.debug('moveGranuleFiles', source, target);
      return moveGranuleFile(source, target).then(() => {
        processedFiles.push({
          bucket: target.Bucket,
          key: target.Key,
          name: file.name || file.fileName
        });
      });
    }

    let fileBucket;
    let fileKey;
    if (file.bucket && file.key) {
      fileBucket = file.bucket;
      fileKey = file.key;
    } else if (file.filename) {
      const parsed = S3.parseS3Uri(file.filename);
      fileBucket = parsed.Bucket;
      fileKey = parsed.Key;
    } else {
      throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
    }

    processedFiles.push({
      bucket: fileBucket,
      key: fileKey,
      name: file.name || file.fileName
    });

    return Promise.resolve();
  });
  await Promise.all(moveFileRequests);
  return processedFiles;
}

/**
  * rename s3 file with timestamp
  *
  * @param {string} bucket - bucket of the file
  * @param {string} key - s3 key of the file
  * @returns {Promise} promise that resolves when file is renamed
  */
async function renameS3FileWithTimestamp(bucket, key) {
  const formatString = 'YYYYMMDDTHHmmssSSS';
  const timestamp = (await S3.headObject(bucket, key)).LastModified;
  let renamedKey = `${key}.v${moment.utc(timestamp).format(formatString)}`;

  // if the renamed file already exists, get a new name
  // eslint-disable-next-line no-await-in-loop
  while (await S3.s3ObjectExists({ Bucket: bucket, Key: renamedKey })) {
    renamedKey = `${key}.v${moment.utc(timestamp).add(1, 'milliseconds').format(formatString)}`;
  }

  log.debug(`renameS3FileWithTimestamp renaming ${bucket} ${key} to ${renamedKey}`);
  return exports.moveGranuleFile(
    { Bucket: bucket, Key: key }, { Bucket: bucket, Key: renamedKey }
  );
}

/**
  * get all renamed s3 files for a given bucket and key
  *
  * @param {string} bucket - bucket of the file
  * @param {string} key - s3 key of the file
  * @returns {Array<Object>} returns renamed files
  */
async function getRenamedS3File(bucket, key) {
  const s3list = await S3.listS3ObjectsV2({ Bucket: bucket, Prefix: `${key}.v` });
  return s3list.map((c) => ({ Bucket: bucket, Key: c.Key, size: c.Size }));
}

/**
 * check to see if the file has the suffix with timestamp '.vYYYYMMDDTHHmmssSSS'
 *
 * @param {string} filename - name of the file
 * @returns {boolean} whether the file is renamed
 */
function isFileRenamed(filename) {
  const suffixRegex = '\\.v[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1])T(2[0-3]|[01][0-9])[0-5][0-9][0-5][0-9][0-9]{3}$';
  return (filename.match(suffixRegex) !== null);
}

/**
 * Returns the input filename stripping off any versioned timestamp.
 *
 * @param {string} filename
 * @returns {string} - filename with timestamp removed
 */
function unversionFilename(filename) {
  return isFileRenamed(filename) ? filename.split('.').slice(0, -1).join('.') : filename;
}

/**
 * Returns a directive on how to act when duplicate files are encountered.
 *
 * @param {Object} event - lambda function event.
 * @param {Object} event.config - the config object
 * @param {Object} event.config.collection - collection object.

 * @returns {string} - duplicate handling directive.
 */
function duplicateHandlingType(event) {
  const config = get(event, 'config');
  const collection = get(config, 'collection');

  let duplicateHandling = get(config, 'duplicateHandling', get(collection, 'duplicateHandling', 'error'));

  const forceDuplicateOverwrite = get(event, 'cumulus_config.cumulus_context.forceDuplicateOverwrite', false);

  log.debug(`Configured duplicateHandling value: ${duplicateHandling}, forceDuplicateOverwrite ${forceDuplicateOverwrite}`);

  if (forceDuplicateOverwrite === true) duplicateHandling = 'replace';

  return duplicateHandling;
}

module.exports.getRenamedS3File = getRenamedS3File;
module.exports.handleDuplicateFile = handleDuplicateFile;
module.exports.copyGranuleFile = copyGranuleFile;
module.exports.unversionFilename = unversionFilename;
module.exports.moveGranuleFile = moveGranuleFile;
module.exports.moveGranuleFiles = moveGranuleFiles;
module.exports.renameS3FileWithTimestamp = renameS3FileWithTimestamp;
module.exports.generateMoveFileParams = generateMoveFileParams;
module.exports.duplicateHandlingType = duplicateHandlingType;

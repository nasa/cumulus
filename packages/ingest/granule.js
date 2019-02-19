'use strict';

const crypto = require('crypto');
const fs = require('fs-extra');
const cloneDeep = require('lodash.clonedeep');
const flatten = require('lodash.flatten');
const groupBy = require('lodash.groupby');
const moment = require('moment');
const omit = require('lodash.omit');
const os = require('os');
const path = require('path');
const uuidv4 = require('uuid/v4');
const encodeurl = require('encodeurl');
const {
  aws,
  CollectionConfigStore,
  constructCollectionId,
  log,
  errors,
  file: { getFileChecksumFromStream }
} = require('@cumulus/common');
const { buildURL } = require('@cumulus/common/URLUtils');

const { sftpMixin } = require('./sftp');
const { ftpMixin } = require('./ftp');
const { httpMixin } = require('./http');
const { s3Mixin } = require('./s3');
const { baseProtocol } = require('./protocol');

/**
* The abstract Discover class
**/
class Discover {
  /**
  * Discover class constructor
  *
  * @param {Object} event - the cumulus event object
  **/
  constructor(event) {
    if (this.constructor === Discover) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = event.config.buckets;
    this.collection = event.config.collection;
    this.provider = event.config.provider;
    this.useList = event.config.useList;
    this.event = event;

    this.port = this.provider.port;
    this.host = this.provider.host;
    this.path = this.collection.provider_path || '/';

    this.endpoint = buildURL({
      protocol: this.provider.protocol,
      host: this.provider.host,
      port: this.provider.port,
      path: this.path
    });

    this.username = this.provider.username;
    this.password = this.provider.password;

    // create hash with file regex as key
    this.regexes = {};
    this.collection.files.forEach((f) => {
      this.regexes[f.regex] = {
        collection: this.collection.name,
        bucket: this.buckets[f.bucket].name
      };
    });
  }

  /**
   * Receives a file object and adds granule-specific properties to it
   *
   * @param {Object} file - the file object
   * @returns {Object} Updated file with granuleId, bucket, and url_path information
   */
  setGranuleInfo(file) {
    const granuleIdMatch = file.name.match(this.collection.granuleIdExtraction);
    const granuleId = granuleIdMatch[1];

    const fileTypeConfig = this.fileTypeConfigForFile(file);

    // Return the file with granuleId, bucket, and url_path added
    return Object.assign(
      cloneDeep(file),
      {
        granuleId,
        bucket: this.buckets[fileTypeConfig.bucket].name,
        url_path: fileTypeConfig.url_path || this.collection.url_path || ''
      }
    );
  }

  /**
   * Search for a file type config in the collection config
   *
   * @param {Object} file - a file object
   * @returns {Object|undefined} a file type config object or undefined if none
   *   was found
   * @private
   */
  fileTypeConfigForFile(file) {
    return this.collection.files.find((fileTypeConfig) => file.name.match(fileTypeConfig.regex));
  }

  /**
   * Discover new granules
   *
   * @returns {Array<Object>} a list of discovered granules
   */
  async discover() {
    let discoveredFiles = [];
    try {
      discoveredFiles = (await this.list())
        // Make sure the file matches the granuleIdExtraction
        .filter((file) => file.name.match(this.collection.granuleIdExtraction))
        // Make sure there is a config for this type of file
        .filter((file) => this.fileTypeConfigForFile(file))
        // Add additional granule-related properties to the file
        .map((file) => this.setGranuleInfo(file));
    }
    catch (error) {
      log.error(`discover exception ${JSON.stringify(error)}`);
    }

    // Group the files by granuleId
    const filesByGranuleId = groupBy(discoveredFiles, (file) => file.granuleId);

    // Build and return the granules
    const granuleIds = Object.keys(filesByGranuleId);
    return granuleIds
      .map((granuleId) => ({
        granuleId,
        dataType: this.collection.dataType,
        version: this.collection.version,
        // Remove the granuleId property from each file
        files: filesByGranuleId[granuleId].map((file) => omit(file, 'granuleId'))
      }));
  }
}

/**
 * This is a base class for ingesting and parsing a single PDR
 * It must be mixed with a FTP or HTTP mixing to work
 *
 * @class
 * @abstract
 */
class Granule {
  /**
   * Constructor for abstract Granule class
   *
   * @param {Object} buckets - s3 buckets available from config
   * @param {Object} collection - collection configuration object
   * @param {Object} provider - provider configuration object
   * @param {string} fileStagingDir - staging directory on bucket to place files
   * @param {boolean} forceDownload - force download of a file
   * @param {boolean} duplicateHandling - duplicateHandling of a file
   */
  constructor(
    buckets,
    collection,
    provider,
    fileStagingDir = 'file-staging',
    forceDownload = false,
    duplicateHandling = 'error'
  ) {
    if (this.constructor === Granule) {
      throw new TypeError('Can not construct abstract class.');
    }

    this.buckets = buckets;
    this.collection = collection;
    this.provider = provider;

    this.port = this.provider.port;
    this.host = this.provider.host;
    this.username = this.provider.username;
    this.password = this.provider.password;
    this.checksumFiles = {};

    this.forceDownload = forceDownload;

    if (fileStagingDir && fileStagingDir[0] === '/') this.fileStagingDir = fileStagingDir.substr(1);
    else this.fileStagingDir = fileStagingDir;

    this.duplicateHandling = duplicateHandling;
  }

  /**
   * Ingest all files in a granule
   *
   * @param {Object} granule - granule object
   * @param {string} bucket - s3 bucket to use for files
   * @returns {Promise<Object>} return granule object
   */
  async ingest(granule, bucket) {
    // for each granule file
    // download / verify checksum / upload

    const stackName = process.env.stackName;
    let dataType = granule.dataType;
    let version = granule.version;

    // if no collection is passed then retrieve the right collection
    if (!this.collection) {
      if (!granule.dataType || !granule.version) {
        throw new Error(
          'Downloading the collection failed because dataType or version was missing!'
        );
      }
      const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
      this.collection = await collectionConfigStore.get(granule.dataType, granule.version);
    }
    else {
      // Collection is passed in, but granule does not define the dataType and version
      if (!dataType) dataType = this.collection.dataType || this.collection.name;
      if (!version) version = this.collection.version;
    }

    // make sure there is a url_path
    this.collection.url_path = this.collection.url_path || '';

    this.collectionId = constructCollectionId(dataType, version);
    this.fileStagingDir = path.join(this.fileStagingDir, this.collectionId);

    const downloadFiles = granule.files
      .filter((f) => this.filterChecksumFiles(f))
      .map((f) => this.ingestFile(f, bucket, this.duplicateHandling));

    log.debug('awaiting all download.Files');
    const files = flatten(await Promise.all(downloadFiles));
    log.debug('finished ingest()');
    return {
      granuleId: granule.granuleId,
      dataType: dataType,
      version: version,
      files
    };
  }

  /**
   * set the url_path of a file based on collection config.
   * Give a url_path set on a file definition higher priority
   * than a url_path set on the min collection object.
   *
   * @param {Object} file - object representing a file of a granule
   * @returns {Object} file object updated with url+path tenplate
   */
  getUrlPath(file) {
    let urlPath = '';

    this.collection.files.forEach((fileDef) => {
      const test = new RegExp(fileDef.regex);
      const match = file.name.match(test);

      if (match && fileDef.url_path) {
        urlPath = fileDef.url_path;
      }
    });

    if (!urlPath) {
      urlPath = this.collection.url_path;
    }

    return urlPath;
  }

  /**
   * Find the collection file config that applies to the given file
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object|undefined} a collection file config or undefined
   * @private
   */
  findCollectionFileConfigForFile(file) {
    return this.collection.files.find((fileConfig) =>
      file.name.match(fileConfig.regex));
  }

  /**
   * Add a bucket property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a bucket property set
   * @private
   */
  addBucketToFile(file) {
    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (!fileConfig) {
      throw new Error(`Unable to update file. Cannot find file config for file ${file.name}`);
    }
    const bucket = this.buckets[fileConfig.bucket].name;

    return Object.assign(cloneDeep(file), { bucket });
  }

  /**
   * Add a url_path property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a url_path property set
   * @private
   */
  addUrlPathToFile(file) {
    let foundFileConfigUrlPath;

    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (fileConfig) foundFileConfigUrlPath = fileConfig.url_path;

    // eslint-disable-next-line camelcase
    const url_path = foundFileConfigUrlPath || this.collection.url_path || '';
    return Object.assign(cloneDeep(file), { url_path });
  }

  /**
   * Filter out md5 checksum files and put them in `this.checksumFiles` object.
   * To be used with `Array.prototype.filter`.
   *
   * @param {Object} file - file object from granule.files
   * @returns {boolean} depending on if file was an md5 checksum or not
   */
  filterChecksumFiles(file) {
    if (file.name.indexOf('.md5') > 0) {
      this.checksumFiles[file.name.replace('.md5', '')] = file;
      return false;
    }

    return true;
  }

  /**
   * Validate a file's checksum and throw an exception if it's invalid
   *
   * @param {Object} file - the file object to be checked
   * @param {string} bucket - s3 bucket name of the file
   * @param {string} key - s3 key of the file
   * @param {Object} [options={}] - options for the this._hash method
   * @returns {Array<string>} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum.
   * Throws an error if the checksum is invalid.
   * @memberof Granule
   */
  async validateChecksum(file, bucket, key, options = {}) {
    const [type, value] = await this.getChecksumFromFile(file);

    if (!type || !value) return [null, null];

    const sum = await aws.checksumS3Objects(type, bucket, key, options);

    if (value !== sum) {
      const message = `Invalid checksum for ${file.name} with type ${file.checksumType} and value ${file.checksumValue}`;
      throw new errors.InvalidChecksum(message);
    }
    return [type, value];
  }

  /**
   * Get cksum checksum value of file
   *
   * @param {string} filepath - filepath of file to checksum
   * @returns {Promise<number>} checksum value calculated from file
   */
  async _cksum(filepath) {
    return getFileChecksumFromStream(fs.createReadStream(filepath));
  }

  /**
  * Get hash of file
  *
  * @param {string} algorithm - algorithm to use for hash,
  * any algorithm accepted by node's `crypto.createHash`
  * https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm_options
  * @param {string} filepath - filepath of file to checksum
  * @returns {Promise} checksum value calculated from file
  **/
  async _hash(algorithm, filepath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const fileStream = fs.createReadStream(filepath);
      fileStream.on('error', reject);
      fileStream.on('data', (chunk) => hash.update(chunk));
      fileStream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Enable versioning on an s3 bucket
   *
   * @param {string} bucket - s3 bucket name
   * @returns {Promise} promise that resolves when bucket versioning is enabled
   */
  async enableBucketVersioning(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await aws.s3().getBucketVersioning({ Bucket: bucket }).promise();

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      aws.s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' }
      }).promise();
    }
  }

  /**
   * Get a checksum from a file
   *
   * @param {Object} file - file object
   * @returns {Array} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum
   */
  async getChecksumFromFile(file) {
    if (file.checksumType && file.checksumValue) {
      return [file.checksumType, file.checksumValue];
    }
    if (this.checksumFiles[file.name]) {
      const checksumInfo = this.checksumFiles[file.name];

      const checksumRemotePath = path.join(checksumInfo.path, checksumInfo.name);

      const downloadDir = await fs.mkdtemp(`${os.tmpdir()}${path.sep}`);
      const checksumLocalPath = path.join(downloadDir, checksumInfo.name);

      let checksumValue;
      try {
        await this.download(checksumRemotePath, checksumLocalPath);
        const checksumFile = await fs.readFile(checksumLocalPath, 'utf8');
        [checksumValue] = checksumFile.split(' ');
      }
      finally {
        await fs.remove(downloadDir);
      }

      // assuming the type is md5
      return ['md5', checksumValue];
    }

    // No checksum found
    return [null, null];
  }

  /**
   * Ingest individual files
   *
   * @private
   * @param {Object} file - file to download
   * @param {string} bucket - bucket to put file in
   * @param {string} duplicateHandling - how to handle duplicate files
   * value can be
   * 'error' to throw an error,
   * 'replace' to replace the duplicate,
   * 'skip' to skip duplicate,
   * 'version' to keep both files if they have different checksums
   * @returns {Array<Object>} returns the staged file and the renamed existing duplicates if any
   */
  async ingestFile(file, bucket, duplicateHandling) {
    // Check if the file exists
    const destinationKey = path.join(this.fileStagingDir, file.name);

    const s3ObjAlreadyExists = await aws.s3ObjectExists({
      Bucket: bucket,
      Key: destinationKey
    });

    // the staged file expected
    const stagedFile = Object.assign(file,
      {
        filename: aws.buildS3Uri(bucket, destinationKey),
        fileStagingDir: this.fileStagingDir,
        url_path: this.getUrlPath(file),
        bucket
      });
    if (s3ObjAlreadyExists) stagedFile.duplicate_found = true;

    log.debug(`file ${destinationKey} exists in ${bucket}: ${s3ObjAlreadyExists}`);
    // Have to throw DuplicateFile and not WorkflowError, because the latter
    // is not treated as a failure by the message adapter.
    if (s3ObjAlreadyExists && duplicateHandling === 'error') {
      throw new errors.DuplicateFile(`${destinationKey} already exists in ${bucket} bucket`);
    }

    // Exit early if we can
    if (s3ObjAlreadyExists && duplicateHandling === 'skip') {
      return [Object.assign(stagedFile,
        { fileSize: (await aws.headObject(bucket, destinationKey)).ContentLength })];
    }

    // Either the file does not exist yet, or it does but
    // we are replacing it with a more recent one or
    // renaming the existing file

    const fileRemotePath = path.join(file.path, file.name);

    // check if renaming file is necessary
    const renamingFile = (s3ObjAlreadyExists && duplicateHandling === 'version') === true;

    // if the file already exists, and duplicateHandling is 'version',
    // we download file to a different name first
    const stagedFileKey = renamingFile ? `${destinationKey}.${uuidv4()}` : destinationKey;

    // stream the source file to s3
    log.debug(`await sync file to s3 ${fileRemotePath}, ${bucket}, ${stagedFileKey}`);
    await this.sync(fileRemotePath, bucket, stagedFileKey);

    // Validate the checksum
    log.debug(`await validateChecksum ${JSON.stringify(file)}, ${bucket}, ${stagedFileKey}`);
    const [checksumType, checksumValue] = await this.validateChecksum(file, bucket, stagedFileKey);

    // compare the checksum of the existing file and new file, and handle them accordingly
    if (renamingFile) {
      const existingFileSum = await
      aws.checksumS3Objects(checksumType || 'CKSUM', bucket, destinationKey);

      const stagedFileSum = checksumValue
      || await aws.checksumS3Objects('CKSUM', bucket, stagedFileKey);

      // if the checksum of the existing file is the same as the new one, keep the existing file,
      // else rename the existing file, and both files are part of the granule.
      if (existingFileSum === stagedFileSum) {
        await aws.deleteS3Object(bucket, stagedFileKey);
      }
      else {
        log.debug(`Renaming file to ${destinationKey}`);
        await exports.renameS3FileWithTimestamp(bucket, destinationKey);
        await exports.moveGranuleFile(
          { Bucket: bucket, Key: stagedFileKey }, { Bucket: bucket, Key: destinationKey }
        );
      }
    }

    const renamedFiles = (duplicateHandling === 'version')
      ? await exports.getRenamedS3File(bucket, destinationKey) : [];

    // return all files, the renamed files don't have the same properties(name, fileSize, checksum)
    // from input file
    return renamedFiles.concat({ Bucket: bucket, Key: destinationKey }).map((f) => {
      if (f.Key === destinationKey) return stagedFile;
      return {
        name: path.basename(f.Key),
        path: file.path,
        filename: aws.buildS3Uri(f.Bucket, f.Key),
        fileSize: f.fileSize,
        fileStagingDir: this.fileStagingDir,
        url_path: this.getUrlPath(file),
        bucket
      };
    });
  }
}
exports.Granule = Granule; // exported to support testing

/**
 * A class for discovering granules using HTTP or HTTPS.
 */
class HttpDiscoverGranules extends httpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using SFTP.
 */
class SftpDiscoverGranules extends sftpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using FTP.
 */
class FtpDiscoverGranules extends ftpMixin(baseProtocol(Discover)) {}

/**
 * A class for discovering granules using S3.
 */
class S3DiscoverGranules extends s3Mixin(baseProtocol(Discover)) {}

/**
 * Ingest Granule from an FTP endpoint.
 */
class FtpGranule extends ftpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an SFTP endpoint.
 */
class SftpGranule extends sftpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an HTTP endpoint.
 */
class HttpGranule extends httpMixin(baseProtocol(Granule)) {}

/**
 * Ingest Granule from an s3 endpoint.
 */
class S3Granule extends s3Mixin(baseProtocol(Granule)) {}

/**
* Select a class for discovering or ingesting granules based on protocol
*
* @param {string} type -`discover` or `ingest`
* @param {string} protocol -`sftp`, `ftp`, `http`, `https` or `s3`
* @returns {function} - a constructor to create a granule discovery object
**/
function selector(type, protocol) {
  if (type === 'discover') {
    switch (protocol) {
    case 'sftp':
      return SftpDiscoverGranules;
    case 'ftp':
      return FtpDiscoverGranules;
    case 'http':
    case 'https':
      return HttpDiscoverGranules;
    case 's3':
      return S3DiscoverGranules;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }
  else if (type === 'ingest') {
    switch (protocol) {
    case 'sftp':
      return SftpGranule;
    case 'ftp':
      return FtpGranule;
    case 'http':
    case 'https':
      return HttpGranule;
    case 's3':
      return S3Granule;
    default:
      throw new Error(`Protocol ${protocol} is not supported.`);
    }
  }

  throw new Error(`${type} is not supported`);
}

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
function copyGranuleFile(source, target, options) {
  const CopySource = encodeurl(`${source.Bucket}/${source.Key}`);

  const params = Object.assign({
    CopySource,
    Bucket: target.Bucket,
    Key: target.Key
  }, (options || {}));

  return aws.s3().copyObject(params).promise()
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
* @returns {Promise} returms a promise that is resolved when the file is moved
**/
async function moveGranuleFile(source, target, options) {
  await copyGranuleFile(source, target, options);
  return aws.s3().deleteObject(source).promise();
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
    const destination = destinations.find((dest) => file.name.match(dest.regex));

    // if there's no match, we skip the file
    if (!destination) return { source: null, target: null, file };

    let source;
    if (file.bucket && file.filepath) {
      source = {
        Bucket: file.bucket,
        Key: file.filepath
      };
    }
    else {
      throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
    }

    const target = {
      Bucket: destination.bucket,
      Key: destination.filepath ? `${destination.filepath}/${file.name}` : file.name
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
 * @param {string} sourceFiles.filepath - current S3 key of file
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
          filepath: target.Key,
          name: file.name
        });
      });
    }

    let fileBucket;
    let fileKey;
    if (file.bucket && file.filepath) {
      fileBucket = file.bucket;
      fileKey = file.filepath;
    }
    else {
      throw new Error(`Unable to determine location of file: ${JSON.stringify(file)}`);
    }

    processedFiles.push({
      bucket: fileBucket,
      filepath: fileKey,
      name: file.name
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
  const timestamp = (await aws.headObject(bucket, key)).LastModified;
  let renamedKey = `${key}.v${moment.utc(timestamp).format(formatString)}`;

  // if the renamed file already exists, get a new name
  // eslint-disable-next-line no-await-in-loop
  while (await aws.s3ObjectExists({ Bucket: bucket, Key: renamedKey })) {
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
  const s3list = await aws.listS3ObjectsV2({ Bucket: bucket, Prefix: `${key}.v` });
  return s3list.map((c) => ({ Bucket: bucket, Key: c.Key, fileSize: c.Size }));
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

module.exports.selector = selector;
module.exports.Discover = Discover;
module.exports.Granule = Granule;
module.exports.FtpDiscoverGranules = FtpDiscoverGranules;
module.exports.FtpGranule = FtpGranule;
module.exports.HttpDiscoverGranules = HttpDiscoverGranules;
module.exports.HttpGranule = HttpGranule;
module.exports.S3Granule = S3Granule;
module.exports.S3DiscoverGranules = S3DiscoverGranules;
module.exports.SftpDiscoverGranules = SftpDiscoverGranules;
module.exports.SftpGranule = SftpGranule;
module.exports.getRenamedS3File = getRenamedS3File;
module.exports.copyGranuleFile = copyGranuleFile;
module.exports.unversionFilename = unversionFilename;
module.exports.moveGranuleFile = moveGranuleFile;
module.exports.moveGranuleFiles = moveGranuleFiles;
module.exports.renameS3FileWithTimestamp = renameS3FileWithTimestamp;
module.exports.generateMoveFileParams = generateMoveFileParams;

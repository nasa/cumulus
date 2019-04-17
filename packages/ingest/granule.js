'use strict';

const fs = require('fs-extra');
const cloneDeep = require('lodash.clonedeep');
const flatten = require('lodash.flatten');
const groupBy = require('lodash.groupby');
const get = require('lodash.get');
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
  errors
} = require('@cumulus/common');
const { buildURL } = require('@cumulus/common/URLUtils');

const { sftpMixin } = require('./sftp');
const { ftpMixin } = require('./ftp');
const { httpMixin } = require('./http');
const { s3Mixin } = require('./s3');
const { baseProtocol } = require('./protocol');
const { normalizeProviderPath } = require('./util');

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
    this.path = normalizeProviderPath(this.collection.provider_path);

    this.endpoint = buildURL({
      protocol: this.provider.protocol,
      host: this.host,
      port: this.port,
      path: this.path
    });

    this.username = this.provider.username;
    this.password = this.provider.password;

    // create hash with file regex as key
    this.regexes = {};
    this.collection.files.forEach((f) => {
      this.regexes[f.regex] = {
        collection: this.collection.name,
        bucket: this.buckets[f.bucket].name,
        fileType: f.fileType
      };
    });
  }

  /**
   * Receives a file object and adds granule-specific properties to it
   *
   * @param {Object} file - the file object
   * @returns {Object} Updated file with granuleId, bucket,
   *                   filetype, and url_path information
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
        url_path: fileTypeConfig.url_path || this.collection.url_path || '',
        fileType: fileTypeConfig.fileType || ''
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
    } catch (error) {
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
   * @param {string} fileStagingDir - staging directory on bucket,
   * files will be placed in collectionId subdirectory
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
    this.supportedChecksumFileTypes = ['md5', 'cksum', 'sha1', 'sha256'];

    this.forceDownload = forceDownload;

    if (fileStagingDir && fileStagingDir[0] === '/') this.fileStagingDir = fileStagingDir.substr(1);
    else this.fileStagingDir = fileStagingDir;

    this.duplicateHandling = duplicateHandling;

    // default collectionId, could be overwritten by granule's collection information
    if (this.collection) {
      this.collectionId = constructCollectionId(
        this.collection.dataType || this.collection.name, this.collection.version
      );
    }
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
    // download / verify integrity / upload

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
    } else {
      // Collection is passed in, but granule does not define the dataType and version
      if (!dataType) dataType = this.collection.dataType || this.collection.name;
      if (!version) version = this.collection.version;
    }

    // make sure there is a url_path
    this.collection.url_path = this.collection.url_path || '';

    this.collectionId = constructCollectionId(dataType, version);

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
   * Filter out checksum files and put them in `this.checksumFiles` object.
   * To be used with `Array.prototype.filter`.
   *
   * @param {Object} file - file object from granule.files
   * @returns {boolean} - whether file was a supported checksum or not
   */
  filterChecksumFiles(file) {
    let unsupported = true;
    this.supportedChecksumFileTypes.forEach((type) => {
      const ext = `.${type}`;
      if (file.name.indexOf(ext) > 0) {
        this.checksumFiles[file.name.replace(ext, '')] = file;
        unsupported = false;
      }
    });

    return unsupported;
  }

  /**
   * Verify a file's integrity using its checksum and throw an exception if it's invalid
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
  async verifyFile(file, bucket, key, options = {}) {
    const [type, value] = await this.retrieveSuppliedFileChecksumInformation(file);
    if (!type || !value) return [null, null];

    await aws.validateS3ObjectChecksum({
      algorithm: type,
      bucket,
      key,
      expectedSum: value,
      options
    });
    return [type, value];
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
   * Retrieve supplied checksum from a file's specification or an accompanying checksum file.
   *
   * @param {Object} file - file object
   * @returns {Array} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum
   */
  async retrieveSuppliedFileChecksumInformation(file) {
    // try to get filespec checksum data
    if (file.checksumType && file.checksumValue) {
      return [file.checksumType, file.checksumValue];
    }
    // read checksum from checksum file
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
      } finally {
        await fs.remove(downloadDir);
      }

      // default type to md5
      let checksumType = 'md5';
      // return type based on filename
      this.supportedChecksumFileTypes.forEach((type) => {
        if (checksumInfo.name.indexOf(type) > 0) {
          checksumType = type;
        }
      });

      return [checksumType, checksumValue];
    }

    // No checksum found
    return [null, null];
  }

  /**
   * Ingest individual files
   *
   * @private
   * @param {Object} file - file to download
   * @param {string} destinationBucket - bucket to put file in
   * @param {string} duplicateHandling - how to handle duplicate files
   * value can be
   * 'error' to throw an error,
   * 'replace' to replace the duplicate,
   * 'skip' to skip duplicate,
   * 'version' to keep both files if they have different checksums
   * @returns {Array<Object>} returns the staged file and the renamed existing duplicates if any
   */
  async ingestFile(file, destinationBucket, duplicateHandling) {
    const fileRemotePath = path.join(file.path, file.name);
    // place files in the <collectionId> subdirectory
    const stagingPath = path.join(this.fileStagingDir, this.collectionId);
    const destinationKey = path.join(stagingPath, file.name);

    // the staged file expected
    const stagedFile = Object.assign(cloneDeep(file),
      {
        filename: aws.buildS3Uri(destinationBucket, destinationKey),
        fileStagingDir: stagingPath,
        url_path: this.getUrlPath(file),
        bucket: destinationBucket
      });
    // bind arguments to sync function
    const syncFileFunction = this.sync.bind(this, fileRemotePath);

    const s3ObjAlreadyExists = await aws.s3ObjectExists(
      { Bucket: destinationBucket, Key: destinationKey }
    );
    log.debug(`file ${destinationKey} exists in ${destinationBucket}: ${s3ObjAlreadyExists}`);
    let versionedFiles = [];
    if (s3ObjAlreadyExists) {
      stagedFile.duplicate_found = true;
      const stagedFileKey = `${destinationKey}.${uuidv4()}`;
      // returns renamed files for 'version', otherwise empty array
      versionedFiles = await exports.handleDuplicateFile({
        source: { Bucket: destinationBucket, Key: stagedFileKey },
        target: { Bucket: destinationBucket, Key: destinationKey },
        duplicateHandling,
        checksumFunction: this.verifyFile.bind(this, file),
        syncFileFunction
      });
    } else {
      log.debug(`await sync file ${fileRemotePath} to s3://${destinationBucket}/${destinationKey}`);
      await syncFileFunction(destinationBucket, destinationKey);
      // Verify file integrity
      log.debug(`await verifyFile ${JSON.stringify(file)}, s3://${destinationBucket}/${destinationKey}`);
      await this.verifyFile(file, destinationBucket, destinationKey);
    }

    // Set final filesize
    stagedFile.fileSize = (await aws.headObject(destinationBucket, destinationKey)).ContentLength;
    // return all files, the renamed files don't have the same properties
    // (name, fileSize, checksum) as input file
    log.debug(`returning ${JSON.stringify(stagedFile)}`);
    return [stagedFile].concat(versionedFiles.map((f) => (
      {
        bucket: destinationBucket,
        name: path.basename(f.Key),
        path: file.path,
        filename: aws.buildS3Uri(f.Bucket, f.Key),
        fileSize: f.fileSize,
        fileStagingDir: stagingPath,
        url_path: this.getUrlPath(file)
      })));
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
  } else if (type === 'ingest') {
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

  return aws.s3CopyObject(params)
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
  return aws.deleteS3Object(source.Bucket, source.Key);
}

async function moveGranuleFileWithVersioning(source, target, sourceChecksumObject, copyOptions) {
  const { checksumType, checksumValue } = sourceChecksumObject;
  // compare the checksum of the existing file and new file, and handle them accordingly
  const targetFileSum = await aws.calculateS3ObjectChecksum(
    { algorithm: (checksumType || 'CKSUM'), bucket: target.Bucket, key: target.Key }
  );
  const sourceFileSum = checksumValue || await aws.calculateS3ObjectChecksum(
    { algorithm: 'CKSUM', bucket: source.Bucket, key: source.Key }
  );

  // if the checksum of the existing file is the same as the new one, keep the existing file,
  // else rename the existing file, and both files are part of the granule.
  if (targetFileSum === sourceFileSum) {
    await aws.deleteS3Object(source.Bucket, source.Key);
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
    // sync to staging location if required and verify integrity
    if (syncFileFunction) await syncFileFunction(source.Bucket, source.Key);
    let sourceChecksumObject = {};
    if (checksumFunction) {
      const [checksumType, checksumValue] = await checksumFunction(source.Bucket, source.Key);
      sourceChecksumObject = { checksumType, checksumValue };
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
      // await verifyFile
      if (checksumFunction) await checksumFunction(target.Bucket, target.Key);
    } else {
      await moveGranuleFile(source, target, copyOptions);
    }
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
      source = aws.parseS3Uri(file.filename);
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
      const parsed = aws.parseS3Uri(file.filename);
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
module.exports.handleDuplicateFile = handleDuplicateFile;
module.exports.copyGranuleFile = copyGranuleFile;
module.exports.unversionFilename = unversionFilename;
module.exports.moveGranuleFile = moveGranuleFile;
module.exports.moveGranuleFiles = moveGranuleFiles;
module.exports.renameS3FileWithTimestamp = renameS3FileWithTimestamp;
module.exports.generateMoveFileParams = generateMoveFileParams;
module.exports.duplicateHandlingType = duplicateHandlingType;

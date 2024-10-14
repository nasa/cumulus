'use strict';

const flatten = require('lodash/flatten');
const has = require('lodash/has');
const path = require('path');
const uuidv4 = require('uuid/v4');
const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const { constructCollectionId } = require('@cumulus/message/Collections');
const log = require('@cumulus/common/log');
const { removeNilProperties } = require('@cumulus/common/util');
const errors = require('@cumulus/errors');
const { buildProviderClient, fetchTextFile } = require('@cumulus/ingest/providerClientUtils');
const { handleDuplicateFile } = require('@cumulus/ingest/granule');

const addChecksumToFile = async (providerClient, dataFile, checksumFile) => {
  if (dataFile.checksumType && dataFile.checksum) return dataFile;
  if (checksumFile === undefined) return dataFile;

  const checksumType = checksumFile.name.split('.').pop();

  let checksum = (await fetchTextFile({
    providerClient,
    remotePath: path.join(checksumFile.path, checksumFile.name),
    remoteAltBucket: checksumFile.source_bucket,
  })).split(' ').shift();

  if (checksumType === 'cksum') {
    checksum = Number(checksum);
  }

  return { ...dataFile, checksum, checksumType };
};

const collectionNameFrom = (granule = {}, collection = {}) =>
  granule.dataType || collection.name;

const collectionVersionFrom = (granule = {}, collection = {}) =>
  granule.version || collection.version;

const fetchCollection = ({ systemBucket, stackName, name, version }) => {
  if (!name) throw new TypeError('name missing');
  if (!version) throw new TypeError('version missing');

  const collectionConfigStore = new CollectionConfigStore(
    systemBucket,
    stackName
  );

  return collectionConfigStore.get(name, version);
};

const hasChecksumFileExtension = (file) => ['.md5', '.cksum', '.sha1', '.sha256'].includes(path.extname(file.name));

class GranuleFetcher {
  /**
   * Constructor for GranuleFetcher class.
   *
   * @param {Object} kwargs - keyword arguments
   * @param {Object} kwargs.buckets - s3 buckets available from config
   * @param {Object} kwargs.collection - collection configuration object
   * @param {Object} kwargs.provider - provider configuration object
   * @param {string} kwargs.fileStagingDir - staging directory on bucket,
   *    files will be placed in collectionId subdirectory
   * @param {string} kwargs.duplicateHandling - duplicateHandling of a file;
   *    one of 'replace', 'version', 'skip', or 'error' (default)
   */
  constructor({
    buckets,
    collection,
    provider,
    fileStagingDir = 'file-staging',
    duplicateHandling = 'error',
  }) {
    this.buckets = buckets;
    this.collection = collection;

    this.fileStagingDir = (fileStagingDir && fileStagingDir[0] === '/')
      ? fileStagingDir.substr(1)
      : fileStagingDir;

    this.duplicateHandling = duplicateHandling;

    // default collectionId, could be overwritten by granule's collection information
    if (collection) {
      this.collectionId = constructCollectionId(collection.name, collection.version);
    }

    this.provider = provider;
  }

  /**
   * Ingest all files in a granule
   *
   * @param {Object} kwargs - keyword parameters
   * @param {Object} kwargs.granule - granule object
   * @param {string} kwargs.bucket - s3 bucket to use for files
   * @param {boolean} [kwargs.fastDownload=false] - whether fast download is performed using
   *    parallel reads
   * @param {boolean} [kwargs.syncChecksumFiles=false] - if `true`, also ingest
   *    checksum files
   * @returns {Promise<Object>} return granule object
   */
  async ingest({ granule, bucket, fastDownload = false, syncChecksumFiles = false }) {
    // for each granule file
    // download / verify integrity / upload

    const collectionName = collectionNameFrom(granule, this.collection);
    const collectionVersion = collectionVersionFrom(granule, this.collection);

    if (!this.collection) {
      this.collection = await fetchCollection({
        systemBucket: bucket,
        stackName: process.env.stackName,
        name: collectionName,
        version: collectionVersion,
      });
    }

    // make sure there is a url_path
    this.collection.url_path = this.collection.url_path || '';
    this.collectionId = constructCollectionId(collectionName, collectionVersion);

    const filesWithChecksums = await this.addChecksumsToFiles(granule.files);

    const filesToDownload = filesWithChecksums.filter(
      (f) => syncChecksumFiles || !this.isChecksumFile(f)
    );

    const downloadPromises = filesToDownload.map((file) => this.ingestFile(
      file,
      bucket,
      this.duplicateHandling,
      fastDownload
    ));
    log.debug('awaiting all download.Files');
    const downloadResults = await Promise.all(downloadPromises);
    log.debug('finished ingest()');

    const downloadFiles = [];
    const granuleDuplicates = [];
    downloadResults.forEach((result) => {
      downloadFiles.push(result.files);
      if (result.duplicate) {
        granuleDuplicates.push(result.duplicate);
      }
    });
    const files = flatten(downloadFiles);

    let granuleDuplicateFiles;
    if (granuleDuplicates.length > 0) {
      granuleDuplicateFiles = {
        granuleId: granule.granuleId,
        files: granuleDuplicates,
      };
    }

    return {
      ingestedGranule: {
        granuleId: granule.granuleId,
        dataType: collectionName,
        version: collectionVersion,
        provider: this.provider.id,
        files,
      },
      granuleDuplicateFiles,
    };
  }

  /**
   * set the url_path of a file based on collection config.
   * Give a url_path set on a file definition higher priority
   * than a url_path set on the min collection object.
   *
   * @param {Object} file - object representing a file of a granule
   * @returns {Object} file object updated with url+path template
   */
  getUrlPath(file) {
    const collectionFileConfig = this.findCollectionFileConfigForFile(file);

    if (collectionFileConfig && collectionFileConfig.url_path) {
      return collectionFileConfig.url_path;
    }

    return this.collection.url_path;
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
   * Check whether file object qualifies as a checksum file based on
   * file extension or file collection config.
   *
   * @param {Object} file - file object
   * @returns {boolean} - whether file is a checksum file
   * @private
   */
  isChecksumFile(file) {
    return this.fileHasChecksumForInCollectionFileConfig(file) || hasChecksumFileExtension(file);
  }

  /**
   * Determine whether given file has a checksumFor property
   *
   * @param {Object} file - file object
   * @returns {boolean} - true/false collection config for file has checksumFor property
   * @private
   */
  fileHasChecksumForInCollectionFileConfig(file) {
    return has(
      this.findCollectionFileConfigForFile(file),
      'checksumFor'
    );
  }

  /**
   * Add checksum types and values to files
   *
   * @param {Array<Object>} files - files objects with name and path
   * @returns {Array<Object>} - files with checksum types and values added
   */
  async addChecksumsToFiles(files) {
    // Map data file name to checksum file object, if it has a checksum file
    const checksumFileOf = files
      .filter((file) => this.isChecksumFile(file))
      .reduce((acc, checksumFile) => {
        const checksumFileConfig = this.findCollectionFileConfigForFile(checksumFile);
        if (has(checksumFileConfig, 'checksumFor')) {
          const checksumForTarget = files.find(
            (file) => file.name.match(checksumFileConfig.checksumFor)
          );
          if (!checksumForTarget) {
            throw new errors.FileNotFound(
              `Could not find file to match ${checksumFile.name} checksumFor ${checksumFileConfig.checksumFor}`
            );
          }
          acc[checksumForTarget.name] = checksumFile;
          return acc;
        }
        const checksumFileExt = path.extname(checksumFile.name);
        const dataFilename = path.basename(checksumFile.name, checksumFileExt);
        acc[dataFilename] = checksumFile;
        return acc;
      }, {});

    const providerClient = buildProviderClient(this.provider);

    let filesToReturn;
    try {
      await providerClient.connect();

      filesToReturn = await Promise.all(
        files.map((file) => addChecksumToFile(
          providerClient, file, checksumFileOf[file.name]
        ))
      );
    } finally {
      await providerClient.end();
    }

    return filesToReturn;
  }

  /**
   * Verify a file's integrity using its checksum and throw an exception if it's invalid.
   * Verify file's size if checksum type or value is not available.
   * Logs warning if neither check is possible.
   *
   * @param {Object} file - the file object to be checked
   * @param {string} bucket - s3 bucket name of the file
   * @param {string} key - s3 key of the file
   * @param {Object} [options={}] - crypto.createHash options
   * @returns {Array<string>} returns array where first item is the checksum algorithm,
   * and the second item is the value of the checksum.
   * Throws an error if the checksum is invalid.
   * @memberof Granule
   */
  async verifyFile(file, bucket, key, options = {}) {
    if (file.checksumType && file.checksum) {
      await S3.validateS3ObjectChecksum({
        algorithm: file.checksumType,
        bucket,
        key,
        expectedSum: file.checksum,
        options,
      });
    } else {
      log.warn(`Could not verify ${path.basename(key)} expected checksum: ${file.checksum} of type ${file.checksumType}.`);
    }
    if (file.size) {
      const ingestedSize = await S3.getObjectSize({ s3: s3(), bucket, key });
      if (ingestedSize !== (file.size)) {
        throw new errors.UnexpectedFileSize(
          `verifyFile ${path.basename(key)} failed: Actual file size ${ingestedSize}`
          + ` did not match expected file size ${(file.size)}`
        );
      }
    } else {
      log.warn(`Could not verify ${path.basename(key)} expected file size: ${file.size}.`);
    }

    return (file.checksumType || file.checksum)
      ? [file.checksumType, file.checksum]
      : [undefined, undefined];
  }

  /**
   * Enable versioning on an s3 bucket
   *
   * @param {string} bucket - s3 bucket name
   * @returns {Promise} promise that resolves when bucket versioning is enabled
   */
  async enableBucketVersioning(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await s3().getBucketVersioning({ Bucket: bucket });

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }).promise();
    }
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
  async ingestFile(file, destinationBucket, duplicateHandling, fastDownload = false) {
    let duplicateFound;
    const fileRemotePath = path.join(file.path, file.name);
    const sourceBucket = file.source_bucket;
    // place files in the <collectionId> subdirectory
    const stagingPath = S3.s3Join(this.fileStagingDir, this.collectionId);
    const destinationKey = S3.s3Join(stagingPath, file.name);

    // the staged file expected
    const stagedFile = removeNilProperties({
      size: file.size,
      bucket: destinationBucket,
      key: destinationKey,
      source: `${file.path}/${file.name}`,
      fileName: path.basename(destinationKey),
      type: file.type,
      checksumType: file.checksumType,
      checksum: file.checksum ? file.checksum.toString() : file.checksum,
    });

    // if (file.checksum) {
    //   stagedFile.checksum = file.checksum.toString();
    // }

    const s3ObjAlreadyExists = await S3.s3ObjectExists(
      { Bucket: destinationBucket, Key: destinationKey }
    );
    log.debug(`file ${destinationKey} exists in ${destinationBucket}: ${s3ObjAlreadyExists}`);

    let versionedFiles = [];

    const providerClient = buildProviderClient(this.provider);
    try {
      await providerClient.connect();

      // bind arguments to sync function
      const syncFileFunction = providerClient.sync.bind(
        providerClient
      );

      if (s3ObjAlreadyExists) {
        duplicateFound = { bucket: destinationBucket, key: destinationKey };
        const stagedFileKey = `${destinationKey}.${uuidv4()}`;
        // returns renamed files for 'version', otherwise empty array
        versionedFiles = await handleDuplicateFile({
          source: { Bucket: destinationBucket, Key: stagedFileKey },
          target: { Bucket: destinationBucket, Key: destinationKey },
          duplicateHandling,
          checksumFunction: this.verifyFile.bind(this, file),
          syncFileFunction,
          sourceBucket,
          fileRemotePath,
        });
      } else {
        log.debug(`await sync file ${fileRemotePath} to s3://${destinationBucket}/${destinationKey}`);
        await syncFileFunction({
          destinationBucket,
          destinationKey,
          bucket: sourceBucket,
          fileRemotePath,
          fastDownload,
        });
        // Verify file integrity
        log.debug(`await verifyFile ${JSON.stringify(file)}, s3://${destinationBucket}/${destinationKey}`);
        await this.verifyFile(file, destinationBucket, destinationKey);
      }
    } finally {
      await providerClient.end();
    }

    // Set final file size
    stagedFile.size = await S3.getObjectSize({
      s3: s3(),
      bucket: destinationBucket,
      key: destinationKey,
    });

    // return all files, the renamed files don't have the same properties
    // (name, size, checksum) as input file
    log.debug(`returning ${JSON.stringify(stagedFile)}`);
    const returnVal = [stagedFile].concat(versionedFiles.map((f) => (
      {
        bucket: f.Bucket,
        key: f.Key,
        source: `${file.path}/${file.key}`,
        size: f.size,
        fileName: path.basename(f.Key),
        type: f.type,
      })));
    return { files: returnVal, duplicate: duplicateFound };
  }
}

module.exports = GranuleFetcher;

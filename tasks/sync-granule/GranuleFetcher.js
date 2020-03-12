'use strict';

const flatten = require('lodash.flatten');
const path = require('path');
const uuidv4 = require('uuid/v4');
const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const {
  CollectionConfigStore,
  constructCollectionId
} = require('@cumulus/common/collection-config-store');
const log = require('@cumulus/common/log');
const errors = require('@cumulus/errors');
const { buildProviderClient, fetchTextFile } = require('@cumulus/ingest/providerClientUtils');
const { handleDuplicateFile } = require('@cumulus/ingest/granule');

const isChecksumFile = (file) =>
  ['.md5', '.cksum', '.sha1', '.sha256'].includes(path.extname(file.name));

const addChecksumToFile = async (providerClient, checksumFiles, dataFile) => {
  if (dataFile.checksumType && dataFile.checksum) return dataFile;

  const checksumFile = checksumFiles.find((cf) => {
    const ext = path.extname(cf.name);
    return cf.name === `${dataFile.name}${ext}`;
  });

  if (checksumFile === undefined) return dataFile;

  const checksumType = checksumFile.name.split('.').pop();

  const checksum = (await fetchTextFile(
    providerClient,
    path.join(checksumFile.path, checksumFile.name)
  )).split(' ').shift();

  return { ...dataFile, checksum, checksumType };
};

const addChecksumsToFiles = async (providerClient, files) => {
  const checksumFiles = files.filter(isChecksumFile);
  const dataFiles = files.filter((f) => !isChecksumFile(f));

  const updatedDataFiles = await Promise.all(
    dataFiles.map((dataFile) =>
      addChecksumToFile(providerClient, checksumFiles, dataFile))
  );

  return [...checksumFiles, ...updatedDataFiles];
};

class GranuleFetcher {
  /**
   * Constructor for GranuleFetcher class
   *
   * @param {Object} buckets - s3 buckets available from config
   * @param {Object} collection - collection configuration object
   * @param {Object} provider - provider configuration object
   * @param {string} fileStagingDir - staging directory on bucket,
   * files will be placed in collectionId subdirectory
   * @param {boolean} duplicateHandling - duplicateHandling of a file
   */
  constructor(
    buckets,
    collection,
    provider,
    fileStagingDir = 'file-staging',
    duplicateHandling = 'error'
  ) {
    this.buckets = buckets;
    this.collection = collection;

    if (fileStagingDir && fileStagingDir[0] === '/') this.fileStagingDir = fileStagingDir.substr(1);
    else this.fileStagingDir = fileStagingDir;

    this.duplicateHandling = duplicateHandling;

    // default collectionId, could be overwritten by granule's collection information
    if (this.collection) {
      this.collectionId = constructCollectionId(
        this.collection.name, this.collection.version
      );
    }

    this.providerClient = buildProviderClient({
      cmKeyId: provider.cmKeyId,
      encrypted: provider.encrypted,
      host: provider.host,
      password: provider.password,
      port: provider.port,
      privateKey: provider.privateKey,
      protocol: provider.protocol,
      username: provider.username
    });
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
      if (!dataType) dataType = this.collection.name;
      if (!version) version = this.collection.version;
    }

    // make sure there is a url_path
    this.collection.url_path = this.collection.url_path || '';

    this.collectionId = constructCollectionId(dataType, version);

    const filesWithChecksums = await addChecksumsToFiles(
      this.providerClient, granule.files
    );

    const downloadFiles = filesWithChecksums
      .filter((f) => !isChecksumFile(f))
      .map((f) => this.ingestFile(f, bucket, this.duplicateHandling));

    log.debug('awaiting all download.Files');
    const files = flatten(await Promise.all(downloadFiles));
    log.debug('finished ingest()');
    return {
      granuleId: granule.granuleId,
      dataType,
      version,
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
   * Add a bucket property to the given file
   *
   * Note: This returns a copy of the file parameter, it does not modify it.
   *
   * @param {Object} file - an object containing a "name" property
   * @returns {Object} the file with a bucket property set
   * @throws {Error} throws an exception if the file didn't have a matching
   *   config
   * @private
   */
  addBucketToFile(file) {
    const fileConfig = this.findCollectionFileConfigForFile(file);
    if (!fileConfig) {
      throw new Error(`Unable to update file. Cannot find file config for file ${file.name}`);
    }
    const bucket = this.buckets[fileConfig.bucket].name;

    return { ...file, bucket };
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
        options
      });
    } else {
      log.warn(`Could not verify ${file.name} expected checksum: ${file.checksum} of type ${file.checksumType}.`);
    }
    if (file.size || file.fileSize) { // file.fileSize to be removed after CnmToGranule update
      const ingestedSize = await S3.getObjectSize(bucket, key);
      if (ingestedSize !== (file.size || file.fileSize)) { // file.fileSize to be removed
        throw new errors.UnexpectedFileSize(
          `verifyFile ${file.name} failed: Actual file size ${ingestedSize}`
          + ` did not match expected file size ${(file.size || file.fileSize)}`
        );
      }
    } else {
      log.warn(`Could not verify ${file.name} expected file size: ${file.size}.`);
    }

    return (file.checksumType || file.checksum)
      ? [file.checksumType, file.checksum]
      : [null, null];
  }

  /**
   * Enable versioning on an s3 bucket
   *
   * @param {string} bucket - s3 bucket name
   * @returns {Promise} promise that resolves when bucket versioning is enabled
   */
  async enableBucketVersioning(bucket) {
    // check that the bucket has versioning enabled
    const versioning = await s3().getBucketVersioning({ Bucket: bucket }).promise();

    // if not enabled, make it enabled
    if (versioning.Status !== 'Enabled') {
      s3().putBucketVersioning({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' }
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
  async ingestFile(file, destinationBucket, duplicateHandling) {
    const fileRemotePath = path.join(file.path, file.name);
    // place files in the <collectionId> subdirectory
    const stagingPath = path.join(this.fileStagingDir, this.collectionId);
    const destinationKey = path.join(stagingPath, file.name);

    // the staged file expected
    const stagedFile = {
      ...file,
      filename: S3.buildS3Uri(destinationBucket, destinationKey),
      fileStagingDir: stagingPath,
      url_path: this.getUrlPath(file),
      bucket: destinationBucket
    };
    // bind arguments to sync function
    const syncFileFunction = this.providerClient.sync.bind(this.providerClient, fileRemotePath);

    const s3ObjAlreadyExists = await S3.s3ObjectExists(
      { Bucket: destinationBucket, Key: destinationKey }
    );
    log.debug(`file ${destinationKey} exists in ${destinationBucket}: ${s3ObjAlreadyExists}`);

    let versionedFiles = [];
    if (s3ObjAlreadyExists) {
      stagedFile.duplicate_found = true;
      const stagedFileKey = `${destinationKey}.${uuidv4()}`;
      // returns renamed files for 'version', otherwise empty array
      versionedFiles = await handleDuplicateFile({
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

    // Set final file size
    stagedFile.size = await S3.getObjectSize(destinationBucket, destinationKey);
    delete stagedFile.fileSize; // CUMULUS-1269: delete obsolete field until CnmToGranule is patched
    // return all files, the renamed files don't have the same properties
    // (name, size, checksum) as input file
    log.debug(`returning ${JSON.stringify(stagedFile)}`);
    return [stagedFile].concat(versionedFiles.map((f) => (
      {
        bucket: destinationBucket,
        name: path.basename(f.Key),
        path: file.path,
        filename: S3.buildS3Uri(f.Bucket, f.Key),
        size: f.size,
        fileStagingDir: stagingPath,
        url_path: this.getUrlPath(file)
      })));
  }
}

module.exports = GranuleFetcher;

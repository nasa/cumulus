/* eslint no-unused-vars: ["error", { "ignoreRestSiblings": true }] */

'use strict';

const flow = require('lodash/flow');
const isInteger = require('lodash/isInteger');
const partial = require('lodash/partial');
const pick = require('lodash/pick');
const urljoin = require('url-join');
const { getObjectSize, parseS3Uri } = require('@cumulus/aws-client/S3');
const { removeNilProperties } = require('@cumulus/common/util');
const Logger = require('@cumulus/logger');
const schemas = require('../models/schemas');

const log = new Logger({ sender: 'api/lib/FileUtils' });
const getBucket = (file) => {
  if (file.bucket) return file.bucket;
  if (file.filename) return parseS3Uri(file.filename).Bucket;
  return undefined;
};

const getChecksum = (file) => {
  if (file.checksum) return file.checksum;
  if (file.checksumValue) return file.checksumValue;
  return undefined;
};

const getFileName = (file) => {
  if (file.fileName) return file.fileName;
  if (file.name) return file.name;
  return undefined;
};

const getKey = (file) => {
  if (file.key) return file.key;
  if (file.filename) return parseS3Uri(file.filename).Key;
  return undefined;
};

const buildFileSourceURL = (providerURL, file) => {
  if (!file.path) {
    throw new TypeError('Cannot build a source URL for a file without a path property');
  }

  return urljoin(providerURL, file.path, getFileName(file));
};

const simpleFieldAdder = (field, getter) =>
  (file) => ({ ...file, [field]: getter(file) });

const setBucket = simpleFieldAdder('bucket', getBucket);

const setChecksum = simpleFieldAdder('checksum', getChecksum);

const setFileName = simpleFieldAdder('fileName', getFileName);

const setKey = simpleFieldAdder('key', getKey);

const setS3FileSize = async (s3, file) => {
  if (isInteger(file.size)) return file;

  if (isInteger(file.fileSize)) {
    const newFileObj = { ...file, size: file.fileSize };
    delete newFileObj.fileSize;
    return newFileObj;
  }

  try {
    const size = await getObjectSize({
      s3,
      bucket: file.bucket,
      key: file.key,
    });

    return { ...file, size };
  } catch (error) {
    log.debug(`Unable to get object size for file: ${JSON.stringify(file, null, 2)}, Cause: ${error}`);
    return file;
  }
};

const parseSource = (inFile) => {
  if (!inFile.source || inFile.bucket !== null || inFile.key !== null) return inFile;

  const { key, bucket, ...file } = inFile;
  try {
    const parsedFile = parseS3Uri(file.source);
    return {
      ...{ key: parsedFile.Key, bucket: parsedFile.Bucket },
      ...file,
    };
  } catch (error) {
    return inFile;
  }
};

const setSource = (providerURL, file) => {
  if (!providerURL || !file.path) return file;

  return {
    ...file,
    source: buildFileSourceURL(providerURL, file),
  };
};

const filterDatabaseProperties = (file) =>
  pick(
    file,
    Object.keys(schemas.granule.properties.files.items.properties)
  );

const buildDatabaseFile = (s3, providerURL, file) =>
  flow([
    setBucket,
    setKey,
    setChecksum,
    setFileName,
    partial(setSource, providerURL),
    parseSource,
    partial(setS3FileSize, s3), // This one is last because it returns a Promise
  ])(file);

const cleanDatabaseFile = (file) =>
  flow([
    filterDatabaseProperties,
    removeNilProperties,
  ])(file);

const buildDatabaseFiles = async ({ s3, providerURL, files = [] }) => await Promise.all(
  files.map(partial(buildDatabaseFile, s3, providerURL))
).then((newFiles) => newFiles.map(cleanDatabaseFile));

module.exports = {
  setSource,
  buildDatabaseFile,
  buildDatabaseFiles,
  buildFileSourceURL,
  filterDatabaseProperties,
  getChecksum,
  getFileName,
  setS3FileSize,
  getBucket,
  getKey,
};

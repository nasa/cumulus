'use strict';

const flow = require('lodash.flow');
const isInteger = require('lodash.isinteger');
const partial = require('lodash.partial');
const pick = require('lodash.pick');
const urljoin = require('url-join');
const { getObjectSize, parseS3Uri } = require('@cumulus/common/aws');
const { removeNilProperties } = require('@cumulus/common/util');
const schemas = require('../models/schemas');

const getBucket = (file) => {
  if (file.bucket) return file.bucket;
  if (file.filename) return parseS3Uri(file.filename).Bucket;
  return null;
};

const getChecksum = (file) => {
  if (file.checksum) return file.checksum;
  if (file.checksumValue) return file.checksumValue;
  return null;
};

const getFileName = (file) => {
  if (file.fileName) return file.fileName;
  if (file.name) return file.name;
  return null;
};

const getKey = (file) => {
  if (file.key) return file.key;
  if (file.filename) return parseS3Uri(file.filename).Key;
  return null;
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

const setS3FileSize = async (file) => {
  if (isInteger(file.size)) return file;
  if (isInteger(file.fileSize)) {
    const newFileObj = { ...file, size: file.fileSize };
    delete newFileObj.fileSize;
    return newFileObj;
  }

  try {
    const size = await getObjectSize(file.bucket, file.key);
    return { ...file, size };
  } catch (error) {
    return file;
  }
};

const setSource = (providerURL, file) => {
  if (!providerURL || !file.path) return file;

  return {
    ...file,
    source: buildFileSourceURL(providerURL, file)
  };
};

const filterDatabaseProperties = (file) =>
  pick(
    file,
    Object.keys(schemas.granule.properties.files.items.properties)
  );

const buildDatabaseFile = (providerURL, file) =>
  flow([
    setBucket,
    setKey,
    setChecksum,
    setFileName,
    partial(setSource, providerURL),
    filterDatabaseProperties,
    removeNilProperties,
    setS3FileSize // This one is last because it returns a Promise
  ])(file);

const buildDatabaseFiles = async ({ providerURL, files }) =>
  Promise.all(
    files.map(partial(buildDatabaseFile, providerURL))
  );

module.exports = {
  setSource,
  buildDatabaseFiles,
  buildFileSourceURL,
  filterDatabaseProperties,
  getChecksum,
  getFileName
};

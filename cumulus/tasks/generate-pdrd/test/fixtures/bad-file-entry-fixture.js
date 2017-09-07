'use strict';


const invalidDirectory = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID DIRECTORY']]
  },
  error: 'INVALID DIRECTORY'
};

const invalidDataType = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID_DATA_TYPE']]
  },
  error: 'INVALID_DATA_TYPE'
};

const invalidFileChecksumValue = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID FILE_CKSUM_VALUE']]
  },
  error: 'INVALID FILE_CKSUM_VALUE'
};

const missingFileChecksum = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['MISSING FILE_CKSUM_VALUE PARAMETER']]
  },
  error: 'MISSING FILE_CKSUM_VALUE PARAMETER'
};

const unsupportedChecksumType = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['UNSUPPORTED CHECKSUM TYPE']]
  },
  error: 'UNSUPPORTED CHECKSUM TYPE'
};

const missingChecksumType = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['MISSING FILE_CKSUM_TYPE PARAMETER']]
  },
  error: 'MISSING FILE_CKSUM_TYPE PARAMETER'
};

const invalidFileType = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID FILE TYPE']]
  },
  error: 'INVALID FILE TYPE'
};

const invalidFileId = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID FILE ID']]
  },
  error: 'INVALID FILE ID'
};

const invalidFileSize = {
  input: {
    topLevelErrors: [],
    fileGroupErrors: [['INVALID FILE SIZE']]
  },
  error: 'INVALID FILE SIZE'
};

exports.fixtures = [
  invalidDirectory,
  invalidDataType,
  invalidFileChecksumValue,
  missingFileChecksum,
  unsupportedChecksumType,
  missingChecksumType,
  invalidFileType,
  invalidFileId,
  invalidFileSize
]

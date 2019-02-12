'use strict';

const { parseS3Uri } = require('@cumulus/common/aws');

const getKeyFromFile = (file) => {
  if (file.filename) return parseS3Uri(file.filename).Key;
  if (file.filepath) return file.filepath;
  if (file.name) return file.name;

  throw new Error(`Unable to determine S3 key of file: ${JSON.stringify(file)}`);
};

const cumulusMessageFileToAPIFile = (file) => {
  const apiFile = {
    ...file,
    filepath: getKeyFromFile(file)
  };

  delete apiFile.filename;

  return apiFile;
};

module.exports = {
  cumulusMessageFileToAPIFile
};

'use strict';

const awsClients = require('@cumulus/aws-client/services');
const { isNil } = require('@cumulus/common/util');

const { buildDatabaseFiles } = require('./FileUtils');

const translateGranule = async (granule) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await buildDatabaseFiles({
      s3: awsClients.s3(),
      files: granule.files,
    }),
  };
};

module.exports = {
  translateGranule,
};

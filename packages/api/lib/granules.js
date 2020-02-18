const { isNil } = require('@cumulus/common/util');

const { buildDatabaseFiles } = require('./FileUtils');

const translateGranule = async (granule) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await buildDatabaseFiles({ files: granule.files })
  };
};

module.exports = {
  translateGranule
};

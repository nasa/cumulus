const {
  randomStringFromRegex,
} = require('@cumulus/common/test-utils');

const {
  updateAndUploadTestFileToBucket,
} = require('./testUtils');

const uploadS3GranuleDataForDiscovery = async ({
  bucket,
  prefix,
}) => {
  const s3Data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
  ];
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

  const newGranuleId = randomStringFromRegex(granuleRegex);
  await Promise.all(s3Data.map(async (file) => await updateAndUploadTestFileToBucket({
    file,
    bucket,
    prefix,
    targetReplacementRegex: 'MOD09GQ.A2016358.h13v04.006.2016360104606',
    targetReplacementString: newGranuleId,
  })));
  return {
    granuleId: newGranuleId,
  };
};

module.exports = {
  uploadS3GranuleDataForDiscovery,
};

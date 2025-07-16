const fs = require('fs');

const {
  randomStringFromRegex,
} = require('@cumulus/common/test-utils');

const {
  updateAndUploadTestFileToBucket,
} = require('./testUtils');

const uploadS3GranuleDataForDiscovery = async ({
  bucket,
  prefix,
  multipleFileSets,
}) => {
  const s3Data = [
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
  ];
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

  const newGranuleId = randomStringFromRegex(granuleRegex);

  for (var i = 1; i <= multipleFileSets; i++) {
    console.log("i = " + i);

    await Promise.all(s3Data.map(async (file) => {
      var oldKey = '.2016360104606';
      var newKey = '.2016360104606' + i;

      var fileCopy = file.replace(oldKey, newKey);
      console.log("fileCopy", fileCopy);

      var filePath = require.resolve(file);
      console.log("filePath", filePath);

      const filePathCopy = filePath.replace(oldKey, newKey);
      console.log("filePathCopy", filePathCopy);

      fs.copyFileSync(filePath, filePathCopy);

      await updateAndUploadTestFileToBucket({
        file: fileCopy,
        bucket,
        prefix,
        targetReplacementRegex: 'MOD09GQ.A2016358.h13v04.006.2016360104606',
        targetReplacementString: newGranuleId,
      });

      //fs.unlinkSync(filePathCopy);
    }));
  }

  return {
    granuleId: newGranuleId,
  };
};

module.exports = {
  uploadS3GranuleDataForDiscovery,
};

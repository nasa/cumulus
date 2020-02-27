'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');

const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  getDistributionApiRedirect,
  getTEARequestHeaders
} = require('@cumulus/integration-tests/api/distribution');

const {
  loadConfig,
  createTestDataPath,
  createTimestampedTestId,
  uploadTestDataToBucket,
  deleteFolder
} = require('../../helpers/testUtils');
const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');

const s3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met'
];

describe('Distribution API', () => {
  let fileKey;
  let protectedBucketName;
  let publicBucketName;
  let testDataFolder;
  let headers;

  beforeAll(async () => {
    try {
      const config = await loadConfig();

      process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
      setDistributionApiEnvVars();

      headers = await getTEARequestHeaders(config.stackName);

      const bucketsConfig = new BucketsConfig(config.buckets);
      protectedBucketName = bucketsConfig.protectedBuckets()[0].name;
      publicBucketName = bucketsConfig.publicBuckets()[0].name;
      process.env.stackName = config.stackName;

      const testId = createTimestampedTestId(config.stackName, 'DistributionAPITest');
      testDataFolder = createTestDataPath(testId);
      console.log(`Distribution API tests running in ${testDataFolder}`);
      fileKey = `${testDataFolder}/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met`;

      await Promise.all([
        uploadTestDataToBucket(protectedBucketName, s3Data, testDataFolder),
        uploadTestDataToBucket(publicBucketName, s3Data, testDataFolder)
      ]);
    } catch (err) {
      console.log(err);
    }
  });

  afterAll(async () => {
    await Promise.all([
      deleteFolder(protectedBucketName, testDataFolder),
      deleteFolder(publicBucketName, testDataFolder)
    ]);
  });

  describe('handles requests for files over HTTPS', () => {
    let fileChecksum;
    let protectedFilePath;
    let publicFilePath;

    beforeAll(async () => {
      fileChecksum = await generateChecksumFromStream(
        'cksum',
        fs.createReadStream(require.resolve(s3Data[0]))
      );
      publicFilePath = `/${publicBucketName}/${fileKey}`;
      protectedFilePath = `/${protectedBucketName}/${fileKey}`;
    });

    describe('an authorized user', () => {
      it('downloads the protected science file for authorized requests', async () => {
        const s3SignedUrl = await getDistributionApiRedirect(
          protectedFilePath,
          headers
        );
        const parts = new URL(s3SignedUrl);
        const userName = parts.searchParams.get('A-userid');
        expect(userName).toEqual(process.env.EARTHDATA_USERNAME);

        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(downloadChecksum).toEqual(fileChecksum);
      });

      it('downloads a public science file', async () => {
        const s3SignedUrl = await getDistributionApiRedirect(
          publicFilePath,
          headers
        );
        const parts = new URL(s3SignedUrl);
        const userName = parts.searchParams.get('A-userid');
        expect(userName).toEqual(process.env.EARTHDATA_USERNAME);

        const fileStream = got.stream(s3SignedUrl);
        const downloadChecksum = await generateChecksumFromStream('cksum', fileStream);
        expect(downloadChecksum).toEqual(fileChecksum);
      });
    });
  });
});

'use strict';

const fs = require('fs');
const { URL } = require('url');
const got = require('got');
const jwt = require('jsonwebtoken');

const AccessToken = require('@cumulus/api/models/access-tokens');
const CloudFormation = require('@cumulus/aws-client/CloudFormation');
const SecretsManager = require('@cumulus/aws-client/SecretsManager');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { generateChecksumFromStream } = require('@cumulus/checksum');
const {
  getDistributionApiRedirect
} = require('@cumulus/integration-tests/api/distribution');
const {
  getEarthdataAccessToken
} = require('@cumulus/integration-tests/api/EarthdataLogin');

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

/**
 * Login with Earthdata and get response for redirect back to
 * distribution API.
 */
async function getTestAccessToken() {
  const accessTokenResponse = await getEarthdataAccessToken({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
    requestOrigin: process.env.DISTRIBUTION_ENDPOINT
  });
  return accessTokenResponse;
}

/**
 * Get a JWT to use as a cookie for authenticated TEA requests.
 *
 * @param {Object} accessTokenRecord - An Earthdata Login access token response
 * @param {string} jwtTEASecretName
 *   Name of secret containing keys used by TEA for asymmetric encryption of JWTs
 * @param {string} jwtAlgorithm
 *   Algorithm to use for signing JWTs
 */
async function getTEAJwtCookie(
  accessTokenRecord,
  jwtTEASecretName,
  jwtAlgorithm
) {
  const jwtTEASecretValue = await SecretsManager.getSecretString(jwtTEASecretName)
    .then(JSON.parse);
  const jwtPrivateKey = Buffer.from(jwtTEASecretValue.rsa_priv_key, 'base64');
  const jwtToken = jwt.sign({
    'urs-user-id': accessTokenRecord.username,
    'urs-access-token': accessTokenRecord.accessToken,
    'urs-groups': [],
    exp: accessTokenRecord.expirationTime
  }, jwtPrivateKey, {
    algorithm: jwtAlgorithm
  });
  return jwtToken;
}

describe('Distribution API', () => {
  let fileKey;
  let protectedBucketName;
  let publicBucketName;
  let testDataFolder;
  let accessToken;
  let jwtTeaCookie;

  beforeAll(async () => {
    try {
      const config = await loadConfig();

      process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
      setDistributionApiEnvVars();

      const accessTokenRecord = await getTestAccessToken();
      accessToken = accessTokenRecord.accessToken;

      const { JwtAlgo, JwtKeySecretName } = await CloudFormation.getCfStackParameterValues(
        `${config.stackName}-thin-egress-app`,
        ['JwtAlgo', 'JwtKeySecretName']
      );

      jwtTeaCookie = await getTEAJwtCookie(
        accessTokenRecord,
        JwtKeySecretName,
        JwtAlgo
      );

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

    afterAll(async () => {
      const accessTokensModel = new AccessToken();
      await accessTokensModel.delete({ accessToken });
    });

    describe('an authorized user', () => {
      it('downloads the protected science file for authorized requests', async () => {
        const s3SignedUrl = await getDistributionApiRedirect(
          protectedFilePath,
          accessToken,
          jwtTeaCookie
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
          accessToken,
          jwtTeaCookie
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

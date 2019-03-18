'use strict';

const { URL } = require('url');
const got = require('got');

const { models: { AccessToken } } = require('@cumulus/api');
const { serveDistributionApi } = require('@cumulus/api/bin/serve');
const {
  EarthdataLogin: { getEarthdataAccessToken }
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');
const {
  setDistributionApiEnvVars,
  stopDistributionApi
} = require('../helpers/apiUtils');

const config = loadConfig();


/**
 * Login with Earthdata and get response for redirect back to
 * distribution API.
 */
async function getTestAccessToken() {
  const accessTokenResponse = await getEarthdataAccessToken({
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
    requestOrigin: process.env.DISTRIBUTION_ENDPOINT
  });
  return accessTokenResponse.accessToken;
}


describe('Distribution API', () => {
  let server;

  process.env.AccessTokensTable = `${config.stackName}-AccessTokensTable`;
  const accessTokensModel = new AccessToken();

  beforeAll(async (done) => {
    setDistributionApiEnvVars();

    // Use done() callback to signal end of beforeAll() after the
    // distribution API has started up.
    server = await serveDistributionApi(config.stackName, done);
  });

  afterAll(async (done) => {
    stopDistributionApi(server, done);
  });

  describe('handles requests for temporary credentials', () => {
    let accessToken;

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    it('redirecting to Earthdata login for unauthorized requests to /s3credentials endpoint.', async () => {
      const response = await got(
        `${process.env.DISTRIBUTION_ENDPOINT}/s3credentials`,
        { followRedirect: false }
      );
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });

    it('returning Credentials for authorized requests to /s3credentials endpoint', async () => {
      accessToken = await getTestAccessToken();
      const response = await got(
        `${process.env.DISTRIBUTION_ENDPOINT}/s3credentials`,
        {
          followRedirect: false,
          headers: {
            cookie: [`accessToken=${accessToken}`]
          }
        }
      );
      const returnedCredentials = JSON.parse(response.body);
      expect(returnedCredentials.accessKeyId).toBeDefined();
      expect(returnedCredentials.secretAccessKey).toBeDefined();
      expect(returnedCredentials.sessionToken).toBeDefined();
      expect(returnedCredentials.expiration).toBeDefined();
    });
  });
});

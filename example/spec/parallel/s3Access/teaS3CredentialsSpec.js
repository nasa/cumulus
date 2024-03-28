'use strict';

const { URL } = require('url');
const { STS } = require('@aws-sdk/client-sts');
const base64 = require('base-64');

const { models: { AccessToken } } = require('@cumulus/api');
const {
  EarthdataLogin: { getEarthdataAccessToken },
  distributionApi: { invokeS3CredentialsLambda },
} = require('@cumulus/integration-tests');

const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');
const { loadConfig } = require('../../helpers/testUtils');

describe('When accessing s3credentials endpoint', () => {
  let config;

  beforeAll(async () => {
    config = await loadConfig();
    process.env.stackName = config.stackName;
    process.env.AccessTokensTable = `${config.stackName}-s3-credentials-access-tokens`;

    setDistributionApiEnvVars();
  });

  describe('an unauthenticated request', () => {
    it('redirects to Earthdata login for requests on /s3credentials endpoint.', async () => {
      const response = await invokeS3CredentialsLambda('/s3credentials');
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual('/s3credentials');
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });
  });

  describe('with basic authorization header', () => {
    it('redirects to Earthdata login for requests on /s3credentials endpoint.', async () => {
      const auth = base64.encode(`${process.env.EARTHDATA_USERNAME}:${process.env.EARTHDATA_PASSWORD}`);
      const headers = { authorization: `Basic ${auth}` };
      const response = await invokeS3CredentialsLambda('/s3credentials', headers);
      const authorizeUrl = new URL(response.headers.location);
      expect(authorizeUrl.origin).toEqual(process.env.EARTHDATA_BASE_URL);
      expect(authorizeUrl.searchParams.get('state')).toEqual('/s3credentials');
      expect(authorizeUrl.pathname).toEqual('/oauth/authorize');
    });
  });

  describe('with token associated with an Earthdata Login ID', () => {
    let accessToken;
    let accessTokensModel;
    let accessTokenResponse;
    let username;

    beforeAll(async () => {
      accessTokensModel = new AccessToken();
      username = process.env.EARTHDATA_USERNAME;
      accessTokenResponse = await getEarthdataAccessToken({
        redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
        requestOrigin: process.env.DISTRIBUTION_ENDPOINT,
        storeAccessToken: false,
      }).catch((error) => {
        console.log(error);
        throw error;
      });

      accessToken = accessTokenResponse.accessToken;
    });

    afterAll(async () => {
      await accessTokensModel.delete({ accessToken });
    });

    describe('request with EDL bearer token', () => {
      let creds;
      beforeAll(async () => {
        let response;
        try {
          const headers = { authorization: `Bearer ${accessToken}` };
          response = await invokeS3CredentialsLambda('/s3credentials', headers);
          creds = JSON.parse(response.body);
        } catch (error) {
          console.log(error);
          console.log(`Distribution API response: ${JSON.stringify(response, null, 2)}`);
          throw error;
        }
      });

      it('the expected user can assume same region access', async () => {
        const {
          accessKeyId,
          secretAccessKey,
          sessionToken,
        } = creds;

        const sts = new STS({ credentials: { accessKeyId, secretAccessKey, sessionToken } });
        const whoami = await sts.getCallerIdentity();

        expect(accessKeyId).toBeDefined();
        expect(secretAccessKey).toBeDefined();
        expect(sessionToken).toBeDefined();
        expect(whoami.Arn).toMatch(new RegExp(`arn:aws:sts::\\d{12}:assumed-role/s3-same-region-access-role/${username}.*`));
        expect(whoami.UserId).toMatch(new RegExp(`.*:${username}`));
      });
    });

    describe('request with access token', () => {
      let creds;
      beforeAll(async () => {
        let response;
        try {
          await accessTokensModel.create(accessTokenResponse);
          const headers = { cookie: [`accessToken=${accessToken}`] };
          response = await invokeS3CredentialsLambda('/s3credentials', headers);
          creds = JSON.parse(response.body);
        } catch (error) {
          console.log(error);
          console.log(`Distribution API response: ${JSON.stringify(response, null, 2)}`);
          throw error;
        }
      });

      it('the expected user can assume same region access', async () => {
        const {
          accessKeyId,
          secretAccessKey,
          sessionToken,
        } = creds;

        const sts = new STS({ credentials: { accessKeyId, secretAccessKey, sessionToken } });
        const whoami = await sts.getCallerIdentity();

        expect(accessKeyId).toBeDefined();
        expect(secretAccessKey).toBeDefined();
        expect(sessionToken).toBeDefined();
        expect(whoami.Arn).toMatch(new RegExp(`arn:aws:sts::\\d{12}:assumed-role/s3-same-region-access-role/${username}.*`));
        expect(whoami.UserId).toMatch(new RegExp(`.*:${username}`));
      });
    });
  });
});

'use strict';

const { CMR } = require('@cumulus/cmr-client');
const { loadConfig } = require('../../helpers/testUtils');
const { EarthdataToken } = require('../../../../packages/cmr-client/EarthdataToken');
const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');

describe('When using Earthdata Login Token from CMR', () => {
  let username;
  let password;
  let config;
  let EarthdataTokenObject;
  let CMRObject;
  let failedEarthdataToken;
  let beforeAllFailed = false;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;
      setDistributionApiEnvVars();

      process.env.CMR_ENVIRONMENT = 'UAT';
      process.env.AWS_REGION = 'us-east-1';
      username = process.env.EARTHDATA_USERNAME;
      password = process.env.EARTHDATA_PASSWORD;

      CMRObject = new CMR({
        provider: 'provider',
        username: username,
        password: password,
      });

      EarthdataTokenObject = new EarthdataToken({
        username: username,
        password: password,
        edlEnv: process.env.CMR_ENVIRONMENT,
        token: undefined,
      });

      failedEarthdataToken = new EarthdataToken({
        username: '',
        password: '',
        edlEnv: '',
        token: undefined,
      });
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await EarthdataTokenObject.revokeEDLToken(EarthdataTokenObject.getEDLToken());
  });

  describe('Request for getting an Earthdata Login Token for the user using Earthdata credentials', () => {
    it('gets an Earthdata login token, or creates one for the user if they are missing it', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await EarthdataTokenObject.getEDLToken();
        expect(response).toBeDefined();
        expect(response).toBeInstanceOf(String);
        expect(response.startsWith('Bearer ')).toBeTrue();
      }
    });
  });

  describe('Failed Request for creating an Earthdata Login Token for a user with invalid credentials', () => {
    it('response will return an error because of invalid credentials', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const errormsg = 'Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: 401, statusMessage: Unauthorized';
        expect(await failedEarthdataToken.getEDLToken()).rejects.toThrowError(errormsg);
      }
    });
  });

  describe('Request for getting the EDL token through the CMR object', () => {
    it('gets an Earthdata login token the same way as the EarthdataToken object', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await CMRObject.getToken();
        expect(response).toBeDefined();
        expect(response).toBeInstanceOf(String);
        expect(response.startsWith('Bearer ')).toBeTrue();
      }
    });
  });
});

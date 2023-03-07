'use strict';

const { CMR } = require('@cumulus/cmr-client');
const { getEDLToken, revokeEDLToken } = require('@cumulus/cmr-client/EarthdataLogin');
const { loadConfig } = require('../../helpers/testUtils');

describe('When using Earthdata Login Token from CMR', () => {
  let username;
  let password;
  let config;
  let cmrObject;
  let beforeAllFailed = false;
  let tokenToRevoke;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;

      process.env.CMR_ENVIRONMENT = 'UAT';
      username = process.env.EARTHDATA_USERNAME;
      password = process.env.EARTHDATA_PASSWORD;

      cmrObject = new CMR({
        provider: 'provider',
        username,
        password,
      });
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    tokenToRevoke = await cmrObject.getToken();
    await revokeEDLToken(username, password, process.env.CMR_ENVIRONMENT, tokenToRevoke);
  });

  describe('Request for getting an Earthdata Login Token for the user using Earthdata credentials', () => {
    it('gets an Earthdata login token, or creates one for the user if they are missing it', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const token = await getEDLToken(username, password, process.env.CMR_ENVIRONMENT);
        expect(token).toBeDefined();
        expect(token).toBeInstanceOf(String);
      }
    });
  });

  describe('Request for getting the EDL token through the CMR object', () => {
    it('gets an Earthdata login token the same way as the EarthdataLogin object', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const token = await cmrObject.getToken();
        expect(token).toBeDefined();
        expect(token).toBeInstanceOf(String);
      }
    });
  });
});

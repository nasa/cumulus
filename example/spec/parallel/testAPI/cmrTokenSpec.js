'use strict';

const { CMR } = require('@cumulus/cmr-client');
const { loadConfig } = require('../../helpers/testUtils');
const { getEDLToken, createEDLToken, revokeEDLToken } = require('../../../../packages/cmr-client/EarthdataToken')
const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');

describe('When using Earthdata Login Token from CMR', () => {
    let username;
    let password;
    let config;
    let token;
    let CMRObject;

    beforeAll(async () => {
      config = await loadConfig();
      process.env.stackName = config.stackName;
      setDistributionApiEnvVars();  
    });

    beforeAll(async () => {
        process.env.CMR_ENVIRONMENT = 'UAT';
        username = process.env.EARTHDATA_USERNAME;
        password = process.env.EARTHDATA_PASSWORD;
        CMRObject = new CMR({
            provider: 'provider',
            username: username,
            password: password
        });
    })

    afterAll(async() => {
        await revokeEDLToken(username, password, token);
    })

    describe('Request for creating an Earthdata Login Token for the user using CMR credentials', () => {
        it('gets an Earthdata login token', async() => {
            const response = await getEDLToken(username, password);
            expect(response).toBeDefined();
            expect(response).toBeInstanceOf(String);
            expect(response).toEqual('');
        });
    });
    
    describe('Getting an Earthdata Login Token for the user using CMR credentials', () => {
        it('creates an Earthdata login token', async() => {
            const response = await createEDLToken(username, password);
            expect(response).toBeDefined();
            expect(response).toBeInstanceOf(String);
            token = response;
        });
    });

    describe('Request for getting an Earthdata Login Token after creating one returns a successful token', () => {
        it('gets an Earthdata login token', async() => {
            const response = await getEDLToken(username, password);
            expect(response).toBeDefined();
            expect(response).toBeInstanceOf(String);
        });
    });

    describe('Request for getting an Earthdata Login Token from the CMR object returns a successful token', () => {
        it('gets an Earthdata login token', async() => {
            const response = await CMRObject.getToken();
            expect(response).toBeDefined();
            expect(response).toBeInstanceOf(String);
        });
    });
});

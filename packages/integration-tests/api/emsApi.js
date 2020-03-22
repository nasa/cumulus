'use strict';

const emsApi = require('@cumulus/api-client/ems');
const { deprecate } = require('@cumulus/common/util');

async function getLambdaEmsSettings(lambdaName) {
  deprecate('@cumulus/integration-tests/emsApi.getLambdaEmsSettings', '1.20.0', '@cumulus/cumulus-api-client/ems.getLambdaEmsSettings');
  return emsApi.getLambdaEmsSettings(lambdaName);
}


async function createEmsReports(params) {
  deprecate('@cumulus/integration-tests/emsApi.getLambdaEmsSettings', '1.20.0', '@cumulus/cumulus-api-client/ems.getLambdaEmsSettings');
  return emsApi.createEmsReports(params);
}

module.exports = {
  createEmsReports,
  getLambdaEmsSettings
};

/* eslint-disable no-param-reassign */

'use strict';

const { lambda } = require('@cumulus/common/aws');
const AWS = require('aws-sdk');

async function getAllPages(config, key, listFunction) {
  const lambdaConfig = Object.assign({}, config);
  const page = await listFunction(lambdaConfig).promise();
  if (!page.NextMarker) {
    return page[key];
  }
  const pages = page[key];
  lambdaConfig.Marker = page.NextMarker;

  return pages.concat(await getAllPages(lambdaConfig, key, listFunction.promise()));
}

async function getLambdaAliases(lambdaFunctionName) {
  const config = {
    MaxItems: 10000,
    FunctionName: lambdaFunctionName
  };
  return getAllPages(config, 'Aliases', lambda().listAliases.bind(new AWS.Lambda()));
}

async function getLambdaVersions(lambdaFunctionName) {
  const config = { FunctionName: lambdaFunctionName };
  return getAllPages(config, 'Versions',
    lambda().listVersionsByFunction.bind(new AWS.Lambda()));
}


module.exports = { getLambdaAliases, getLambdaVersions };

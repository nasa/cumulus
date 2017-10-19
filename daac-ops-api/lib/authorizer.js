'use strict';

const get = require('lodash.get');

// Help function to generate an IAM policy
function generatePolicy(principalId, effect, resource) {
  // Required output:
  const authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17'; // default version
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke'; // default action
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  // Optional output with custom properties of the String, Number or Boolean type.
  authResponse.context = {
    stringKey: 'stringval',
    numberKey: 123,
    booleanKey: true
  };

  return authResponse;
}

function generateAllow(principalId, resource) {
  return generatePolicy(principalId, 'Allow', resource);
}

function generateDeny(principalId, resource) {
  return generatePolicy(principalId, 'Deny', resource);
}

function handler(event, context, cb) {
  let ipList = get(process.env, 'IP_LIST', '');
  ipList = ipList.split(',');

  const sourceIp = get(event, 'identity.sourceIp');
  const arn = get(event, 'methodArn');

  if (ipList.indexOf(sourceIp) === -1) {
    return cb(null, generateDeny('user', arn));
  }

  return cb(null, generateAllow('user', arn));
}

module.exports = handler;

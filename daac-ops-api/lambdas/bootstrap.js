/* eslint-disable no-param-reassign */
/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * The module is invoked by CloudFormation as custom resource
 * more info: http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 *  - creating API users
 *  - encrypting CMR user/pass and adding it to configuration files
 */
'use strict';

const https = require('https');
const url = require('url');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const Manager = require('../models/base');
const { Search } = require('../es/search');
const mappings = require('../models/mappings.json');
const physicalId = 'cumulus-bootstraping-daac-ops-api-deployment';

async function bootstrapElasticSearch(host, index = 'cumulus') {
  if (!host) {
    return;
  }

  const esClient = await Search.es(host);

  // check if the index exists
  const exists = await esClient.indices.exists({ index });

  if (!exists) {
    // add mapping
    await esClient.indices.create({
      index,
      body: { mappings }
    });
    log.info(`index ${index} created and mappings added.`);
  }
  else {
    log.info(`index ${index} already exists`);
  }

  return;
}

async function bootstrapUsers(table, records) {
  if (!table) {
    return new Promise(resolve => resolve());
  }
  const user = new Manager(table);

  // delete all user records
  const existingUsers = await user.scan();
  await Promise.all(existingUsers.Items.map(u => user.delete({ userName: u.userName })));
  // add new ones
  const additions = records.map((record) => user.create({
    userName: record.username,
    password: record.password,
    createdAt: Date.now()
  }));

  return Promise.all(additions);
}

async function bootstrapCmrProvider(password) {
  if (!password) {
    return new Promise(resolve => resolve('nopassword'));
  }
  return DefaultProvider.encrypt(password);
}

function sendResponse(event, status, data = {}, cb = () => {}) {
  const body = JSON.stringify({
    Status: status,
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  log.info('RESPONSE BODY:\n', body);

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': body.length
    }
  };

  log.info('SENDING RESPONSE...\n');

  const request = https.request(options, (response) => {
    log.info(`STATUS: ${response.statusCode}`);
    log.info(`HEADERS: ${JSON.stringify(response.headers)}`);
    // Tell AWS Lambda that the function execution is done
    cb();
  });

  request.on('error', (error) => {
    log.info(`sendResponse Error: ${error}`);
    // Tell AWS Lambda that the function execution is done
    cb(error);
  });

  // write data to request body
  request.write(body);
  request.end();
}

function handler(event, context, cb) {
  const es = get(event, 'ResourceProperties.ElasticSearch');
  const users = get(event, 'ResourceProperties.Users');
  const cmr = get(event, 'ResourceProperties.Cmr');
  const requestType = get(event, 'RequestType');

  if (requestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', null, cb);
  }

  const actions = [
    bootstrapElasticSearch(get(es, 'host')),
    bootstrapUsers(get(users, 'table'), get(users, 'records')),
    bootstrapCmrProvider(get(cmr, 'Password'))
  ];

  return Promise.all(actions).then((results) => {
    const data = {
      CmrPassword: results[2]
    };

    return sendResponse(event, 'SUCCESS', data, cb);
  }).catch(e => {
    log.error(e);
    return sendResponse(event, 'FAILED', null, cb);
  });
}

module.exports = handler;

justLocalRun(() => {
  //const a = {};
  //handler(a, {}, (e, r) => console.log(e, r));
  //bootstrapCmrProvider('testing').then(r => {
    //console.log(r)
    //return DefaultProvider.decrypt(r)
  //}).then(r => console.log(r))
    //.catch(e => console.log(e));
});

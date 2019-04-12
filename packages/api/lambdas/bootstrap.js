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

const got = require('got');
const get = require('lodash.get');
const boolean = require('boolean');
const log = require('@cumulus/common/log');
const pLimit = require('p-limit');
const { dynamodb } = require('@cumulus/common/aws');
const { inTestMode } = require('@cumulus/common/test-utils');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { User } = require('../models');
const { Search, defaultIndexAlias } = require('../es/search');
const mappings = require('../models/mappings.json');
const physicalId = 'cumulus-bootstraping-daac-ops-api-deployment';

/**
 * Check the index to see if mappings have been updated since the index was last updated.
 * Return any types that are missing or have missing fields from the mapping.
 *
 * @param {Object} esClient - elasticsearch client instance
 * @param {string} index - index name (cannot be alias)
 * @param {Array<Object>} newMappings - list of mappings to check against
 * @returns {Array<string>} - list of missing indices
 */
async function findMissingMappings(esClient, index, newMappings) {
  const typesResponse = await esClient.indices.getMapping({
    index
  });

  const types = Object.keys(newMappings);
  const indexMappings = get(typesResponse, `${index}.mappings`);

  return types.filter((type) => {
    const oldMapping = indexMappings[type];
    if (!oldMapping) return true;
    const newMapping = newMappings[type];
    // Check for new dynamic templates and properties
    if (newMapping.dynamic_templates && (!oldMapping.dynamic_templates
       || newMapping.dynamic_templates.length
       > oldMapping.dynamic_templates.length)) {
      return true;
    }
    const fields = Object.keys(newMapping.properties);
    return !!fields.filter((field) => !Object.keys(oldMapping.properties).includes(field)).length;
  });
}

/**
 * Initialize elastic search. If the index does not exist, create it with an alias.
 * If an index exists but is not aliased, alias the index.
 *
 * @param {string} host - elastic search host
 * @param {string} index - name of the index to create if does not exist, defaults to 'cumulus'
 * @param {string} alias - alias name for the index, defaults to 'cumulus'
 * @returns {Promise} undefined
 */
async function bootstrapElasticSearch(host, index = 'cumulus', alias = defaultIndexAlias) {
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

    await esClient.indices.putAlias({
      index: index,
      name: alias
    });

    log.info(`index ${index} created with alias ${alias} and mappings added.`);
  } else {
    log.info(`index ${index} already exists`);

    let aliasedIndex = index;

    const aliasExists = await esClient.indices.existsAlias({
      name: alias
    });

    if (!aliasExists) {
      await esClient.indices.putAlias({
        index: index,
        name: alias
      });

      log.info(`Created alias ${alias} for index ${index}`);
    } else {
      const indices = await esClient.indices.getAlias({ name: alias });

      aliasedIndex = Object.keys(indices)[0];

      if (indices.length > 1) {
        log.info(`Multiple indices found for alias ${alias}, using index ${index}.`);
      }
    }

    const missingTypes = await findMissingMappings(esClient, aliasedIndex, mappings);

    if (missingTypes.length > 0) {
      log.info(`Updating mappings for ${missingTypes}`);
      const concurrencyLimit = inTestMode() ? 1 : 3;
      const limit = pLimit(concurrencyLimit);
      const addMissingTypesPromises = missingTypes.map((type) =>
        limit(() => esClient.indices.putMapping({
          index: aliasedIndex,
          type,
          body: get(mappings, type)
        })));

      await Promise.all(addMissingTypesPromises);

      log.info(`Added missing types to index ${aliasedIndex}: ${missingTypes}`);
    }
  }
}

/**
 * Add users to the cumulus user table
 *
 * @param {string} table - dynamodb table name
 * @param {Array} records - array of user records
 * @returns {Promise.<Array>} array of aws dynamodb responses
 */
async function bootstrapUsers(table, records) {
  if (!table) return Promise.resolve();

  const user = new User({ tableName: table });

  // delete all user records
  const existingUsers = await user.scan();
  await Promise.all(existingUsers.Items.map((u) => user.delete(u.userName)));
  // add new ones
  const additions = records.map((record) => user.create({
    userName: record.username,
    password: record.password,
    createdAt: Date.now()
  }));

  return Promise.all(additions);
}

/**
 * Encrypt CMR password
 *
 * @param {string} password - plain text cmr password
 * @returns {Promise.<string>} encrypted cmr password
 */
async function bootstrapCmrProvider(password) {
  if (!password) {
    return new Promise((resolve) => resolve('nopassword'));
  }
  return DefaultProvider.encrypt(password);
}

/**
 * converts dynamoDB backup status to boolean
 *
 * @param {string} status - backup status of the table
 * @returns {boolean} the status in boolean
 */
function backupStatus(status) {
  if (status === 'ENABLED') {
    return true;
  }

  return false;
}

/**
 * Enable/Disable the point-in-time backup feature of given
 * DynamoDB tables
 *
 * @param {Array.<Object>} tables - a list of DynamoDB table names and their pointInTime status
 * @returns {Promise.<Array>} array of dynamoDB aws responses
 */
function bootstrapDynamoDbTables(tables) {
  return Promise.all(tables.map((table) =>
    // check the status of continuous backup
    dynamodb().describeContinuousBackups({ TableName: table.name }).promise()
      .then((r) => {
        const status = backupStatus(r.ContinuousBackupsDescription.ContinuousBackupsStatus);

        // if the status has not changed, skip
        if (status === boolean(table.pointInTime)) {
          return Promise.resolve();
        }
        const params = {
          PointInTimeRecoverySpecification: {
            PointInTimeRecoveryEnabled: boolean(table.pointInTime)
          },
          TableName: table.name
        };
        return dynamodb().updateContinuousBackups(params).promise();
      })));
}

/**
 * Sends response back to CloudFormation
 *
 * @param {Object} event - AWS lambda event object
 * @param {string} status - type of response e.g. success, failure
 * @param {Object} data - response data
 * @returns {Promise} - AWS CloudFormation response
 */
async function sendResponse(event, status, data = {}) {
  const body = JSON.stringify({
    Status: status,
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  log.info('RESPONSE BODY:\n', body);
  log.info('SENDING RESPONSE...\n');

  const r = await got.put(event.ResponseURL, {
    body,
    headers: {
      'content-type': '',
      'content-length': body.length
    }
  });
  log.info(r.body);
}

/**
 * CloudFormation custom resource handler
 *
 * @param {Object} event - AWS Lambda event input
 * @param {Object} context - AWS Lambda context object
 * @param {Function} cb - AWS Lambda callback
 * @returns {Promise} undefined
 */
function handler(event, context, cb) {
  const es = get(event, 'ResourceProperties.ElasticSearch');
  const users = get(event, 'ResourceProperties.Users');
  const cmr = get(event, 'ResourceProperties.Cmr');
  const dynamos = get(event, 'ResourceProperties.DynamoDBTables');
  const requestType = get(event, 'RequestType');

  if (requestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', null).then((r) => cb(null, r));
  }

  const actions = [
    bootstrapElasticSearch(get(es, 'host')),
    bootstrapUsers(get(users, 'table'), get(users, 'records')),
    bootstrapCmrProvider(get(cmr, 'Password')),
    bootstrapDynamoDbTables(dynamos)
  ];

  return Promise.all(actions)
    .then((results) => {
      const data = {
        CmrPassword: results[2]
      };

      return sendResponse(event, 'SUCCESS', data);
    })
    .then((r) => cb(null, r))
    .catch((e) => {
      log.error(e);
      return sendResponse(event, 'FAILED', null);
    })
    .then((r) => cb(null, r));
}

module.exports = {
  handler,
  bootstrapElasticSearch,
  bootstrapDynamoDbTables,
  // for testing
  findMissingMappings
};

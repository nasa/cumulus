/* eslint-disable no-param-reassign */
'use strict';

const _get = require('lodash.get');
const log = require('@cumulus/common/log');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const { handle } = require('../lib/response');
const models = require('../models');
const { Search } = require('../es/search');
const { deleteRecord, indexRule } = require('../es/indexer');
const { RecordDoesNotExist } = require('../lib/errors');
const postPayload = require('../tests/data/rules_post.json');

/**
 * List all providers.
 * @param {object} event aws lambda event object.
 * @param {callback} cb aws lambda callback function
 * @return {undefined}
 */
function list(event, cb) {
  const search = new Search(event, 'rule');
  search.query().then(response => cb(null, response)).catch((e) => {
    cb(e);
  });
}

/**
 * Query a single provider.
 * @param {object} event aws lambda event object.
 * @param {string} granuleId the id of the granule.
 * @return {object} a single granule object.
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');

  const model = new models.Rule();
  return model.get({ name })
    .then((res) => {
      delete res.password;
      cb(null, res);
    }).catch((e) => cb(e));
}

/**
 * Creates a new provider
 * @param {object} event aws lambda event object.
 * @return {object} returns the collection that was just saved.
 */
function post(event, cb) {
  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);
  const name = _get(data, 'name');

  const model = new models.Rule();

  return model.get({ name })
    .then(() => cb({ message: `A record already exists for ${name}` }))
    .catch((e) => {
      if (e instanceof RecordDoesNotExist) {
        return model.create(data)
          .then((r) => {
            data = r;
            return Search.es();
          }).then(esClient => indexRule(esClient, data))
            .then(() => cb(null, { message: 'Record saved', record: data }))
            .catch(err => cb(err));
      }
      return cb(e);
    });
}

/**
 * Updates an existing provider
 * @param {object} event aws lambda event object.
 * @return {object} a mapping of the updated properties.
 */
function put(event, cb) {
  const name = _get(event.pathParameters, 'name');

  let data = _get(event, 'body', '{}');
  data = JSON.parse(data);

  const model = new models.Rule();

  // if the data includes any fields other than state and rule.value
  // throw error
  let check = Object.keys(data).filter(f => (f !== 'state' && f !== 'rule'));
  if (data.rule) {
    check = check.concat(Object.keys(data.rule).filter(f => f !== 'value'));
  }
  if (check.length > 0) {
    const err = {
      message: 'Only state and rule.value values can be changed'
    };
    return cb(err);
  }

  // get the record first
  return model.get({ name })
    .then((originalData) => {
      // if rule type is onetime no change is allowed
      if (originalData.rule.type === 'onetime') {
        const err = {
          message: 'Ingest rule of type "onetime" cannot be edited'
        };
        throw err;
      }
      model.update(originalData, data);
    }).then((r) => {
      data = r;
      return Search.es();
    }).then(esClient => indexRule(esClient, data))
      .then(() => cb(null, data))
      .catch((err) => {
        log.error(err);
        if (err instanceof RecordDoesNotExist) {
          return cb({ message: 'Record does not exist' });
        }
        return cb(err);
      });
}

function del(event, cb) {
  let name = _get(event.pathParameters, 'name', '');
  const model = new models.Rule();

  name = name.replace(/%20/g, ' ');

  return model.get({ name })
    .then((record) => model.delete(record))
    .then(() => Search.es())
    .then((esClient) => deleteRecord(esClient, name, 'rule'))
    .then(() => cb(null, { message: 'Record deleted' }))
    .catch(e => cb(e));
}

function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else if (event.httpMethod === 'POST') {
      post(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      put(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;


justLocalRun(() => {
  handler(postPayload, {
    succeed: r => console.log(r),
    failed: e => console.log(e)
  }, (e, r) => console.log(e, r));
});

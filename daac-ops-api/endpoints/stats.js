'use strict';

const _get = require('lodash.get');
const moment = require('moment');
const log = require('@cumulus/ingest/log');
const handle = require('../lib/response').handle;
const Stats = require('../es/stats');

function getType(event) {
  let index;

  const supportedTypes = {
    granules: 'granule',
    pdrs: 'pdr',
    collections: 'collection',
    logs: 'logs',
    providers: 'provider'
  };

  const typeRequested = _get(event, 'queryStringParameters.type', null);
  const type = _get(supportedTypes, typeRequested);

  return { type, index };
}

function summary(event, cb) {
  let params = _get(event, 'queryStringParameters', {});
  if (!params) {
    params = {};
  }
  params.timestamp__from = _get(
    params,
    'timestamp__from',
    moment().subtract(1, 'day').unix()
  );
  params.timestamp__to = _get(params, 'timestamp__to', Date.now());

  const stats = new Stats({ queryStringParameters: params });
  stats.query().then(r => cb(null, r)).catch(e => cb(e));
}

function histogram(event, cb) {
  const type = getType(event);

  const stats = new Stats(event, type.type, type.index);
  stats.histogram().then(r => cb(null, r)).catch(e => cb(e));
}

function count(event, cb) {
  const type = getType(event);

  const stats = new Stats(event, type.type, type.index);
  stats.count().then(r => cb(null, r)).catch(e => cb(e));
}

function average(event, cb) {
  const type = getType(event);

  const stats = new Stats(event, type.type, type.index);
  stats.avg().then(r => cb(null, r)).catch(e => cb(e));
}

function handler(event, context) {
  log.debug(event);
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.resource === '/stats') {
      summary(event, cb);
    }
    else if (event.httpMethod === 'GET' && event.resource === '/stats/histogram') {
      histogram(event, cb);
    }
    else if (event.httpMethod === 'GET' && event.resource === '/stats/aggregate') {
      count(event, cb);
    }
    else if (event.httpMethod === 'GET' && event.resource === '/stats/average') {
      average(event, cb);
    }
    else {
      summary(event, cb);
    }
  });
}

module.exports = handler;

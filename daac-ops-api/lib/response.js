/* eslint-disable no-param-reassign */
/**
 * This module helps with returning approporiate
 * response via API Gateway Lambda Proxies
 *
 * With the lambda proxy integration, the succeed method of
 * the context object should always be called. It accepts
 * an object that expects a statusCode, headers and body
 */

'use strict';

const get = require('lodash.get');
const log = require('@cumulus/common/log');
const proxy = require('lambda-proxy-utils');
const { User } = require('../models');
const { errorify } = require('./utils');

const BEARER_REGEX = /^ *(?:[Bb][Ee][Aa][Rr][Ee][Rr]) +([A-Za-z0-9._~+/-]+=*) *$/;

function getToken(req) {
  if (!req.headers || typeof req.headers !== 'object') {
    throw new TypeError('argument req is required to have headers property');
  }

  const authorization = req.headers.authorization;

  const match = BEARER_REGEX.exec(authorization);

  if (!match) {
    return undefined;
  }

  return match[1];
}


function resp(context, err, body, status = null, headers = null) {
  if (typeof context.succeed !== 'function') {
    throw new Error('context object with succeed method not provided');
  }

  if (err) {
    log.error(err);
    status = status || 400;
    const message = get(err, 'message', errorify(err));
    const detail = get(err, 'detail');

    body = {
      message,
      detail
    };
  }

  const res = new proxy.Response({ cors: true, statusCode: status });
  res.set('Strict-Transport-Security', 'max-age=31536000');
  if (headers) {
    Object.keys(headers).forEach(h => res.set(h, headers[h]));
  }
  return context.succeed(res.send(body));
}

function handle(event, context, authCheck, func) {
  if (typeof context.succeed !== 'function') {
    throw new Error('context object with succeed method not provided');
  }

  const cb = resp.bind(null, context);
  if (authCheck) {
    const req = new proxy.Request(event);

    const token = getToken(req);

    if (!token) {
      return cb('Invalid Authorization token');
    }

    // get the user
    const u = new User();
    return u.scan({
      filter: 'password = :token',
      values: { ':token': token }
    }).then((results) => {
      if (results.Count < 1 || results.Count > 1) {
        return cb('Invalid Authorization token count');
      }
      const obj = results.Items[0];

      if (!obj.expires) {
        return cb('Invalid Authorization token expires');
      }
      else if (obj.expires < Date.now()) {
        return cb('Session expired');
      }
      return func(cb);
    }).catch(e => cb('Invalid Authorization token', e));
  }
  return func(cb);
}

module.exports.handle = handle;
module.exports.resp = resp;

/**
 * This module helps with returning approporiate
 * response via API Gateway Lambda Proxies
 *
 * With the lambda proxy integration, the succeed method of
 * the context object should always be called. It accepts
 * an object that expects a statusCode, headers and body
 */

'use strict';

const forge = require('node-forge');
const get = require('lodash.get');
const auth = require('basic-auth');
const proxy = require('lambda-proxy-utils');
const log = require('@cumulus/common/log');
const { User } = require('../models');
const { errorify } = require('./utils');

function resp(context, err, _body, _status = null) {
  let status = _status;
  let body = _body;
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
  return context.succeed(res.send(body));
}

function handle(event, context, authCheck, func) {
  if (typeof context.succeed !== 'function') {
    throw new Error('context object with succeed method not provided');
  }

  const cb = resp.bind(null, context);
  if (authCheck) {
    const req = new proxy.Request(event);

    const user = auth(req);

    if (!user) {
      return cb('Invalid Authorization token');
    }

    // hash password
    const md = forge.md.md5.create();
    md.update(user.pass);

    // get the user
    const u = new User();
    return u.get({ userName: user.name }).then((userObj) => {
      if (userObj.password === md.digest().toHex()) {
        return func(cb);
      }
      return cb('Invalid Authorization token');
    }).catch(e => cb(e));
  }
  return func(cb);
}

module.exports.handle = handle;
module.exports.resp = resp;

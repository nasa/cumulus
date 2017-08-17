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
const auth = require('basic-auth');
const proxy = require('lambda-proxy-utils');
const User = require('./models').User;
const errorify = require('./utils').errorify;

export function resp(context, err, _body, _status = null) {
  let status = _status;
  let body = _body;
  if (typeof context.succeed !== 'function') {
    throw new Error('context object with succeed method not provided');
  }

  if (err) {
    //const errMsg = { detail: 'An error occured' };
    status = status || 400;
    //if (typeof body === 'string') errMsg.detail = err;
    //if (err.message) errMsg.detail = err.message;

    body = { error: errorify(err) };
  }

  const res = new proxy.Response({ cors: true, statusCode: status });
  return context.succeed(res.send(body));
}

export function handle(event, context, authCheck, func) {
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

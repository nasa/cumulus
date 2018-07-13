'use strict';

const handle = require('../lib/response').handle;
const { Search } = require('../es/search');

function count(event, cb) {
  return cb(null, {});
}

function list(event, cb) {
  const search = new Search(event, 'logs');
  return search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}


function handler(event, context) {
  return handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.resource === '/stats/logs') {
      return count(event, cb);
    }

    return list(event, cb);
  });
}

module.exports = handler;

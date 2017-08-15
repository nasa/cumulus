'use strict';

const handle = require('../response').handle;
const LogSearch = require('../es/search').LogSearch;

function count(event, cb) {
  return cb(null, {});
}

function list(event, cb) {
  const search = new LogSearch(event);
  search.query().then((response) => cb(null, response)).catch((e) => {
    cb(e);
  });
}


function handler(event, context) {
  handle(event, context, true, (cb) => {
    if (event.httpMethod === 'GET' && event.resource === '/stats/logs') {
      count(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;

'use strict';

const tagged = (log, tag, thisObj) =>
  log.bind(thisObj || console, `[${tag}]`);

const use = (log, error = null) =>
  Object.assign({}, module.exports, {
    log: log,
    info: tagged(log, 'INFO'),
    warn: tagged(log, 'WARN'),
    debug: tagged(log, 'DEBUG'),
    error: tagged(error || log, 'ERROR')
  });

module.exports = {
  use: use,
  tagged: tagged
};

module.exports = use(console.log, console.error); //eslint-disable-line no-console

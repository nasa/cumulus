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

const logs = use(console.log, console.error); // eslint-disable-line no-console
module.exports = Object.assign({}, logs);

const reset = () => {
  Object.assign(module.exports, logs);
};

module.exports = {
  use: use,
  tagged: tagged,
  mute: (...levels) => {
    reset();
    for (const level of levels) {
      module.exports[level] = () => null;
    }
  },
  unmute: () => {
    reset();
  }
};

'use strict';

const { runReaper } = require('./reap-kinesis');

async function handler() {
  await runReaper();
}

exports.handler = handler;

'use strict';

const { runReaper } = require('./reap-kinesis')

async function handler(event) {
  await runReaper();
}

exports.handler = handler;

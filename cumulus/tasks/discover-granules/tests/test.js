'use strict';

const test = require('ava');
const sinon = require('sinon');
const log = require('@cumulus/common/log');
const amsr2 = require('@cumulus/test-data/payloads/amsr2/discover.json');
const queue = require('@cumulus/ingest/queue');
const mur = require('./fixtures/mur.json');
const { handler } = require('../index');

test.cb('test discovering mur granules', (t) => {
  const newMur = JSON.parse(JSON.stringify(mur));

  // make sure queue is not used
  newMur.config.useQueue = false;

  handler(newMur, {}, (e, output) => {
    if (e && e.message.includes('getaddrinfo ENOTFOUND')) {
      log.info('ignoring this test. Test server seems to be down');
    }
    else {
      const granules = output.granules;
      t.is(Object.keys(granules).length, 3);
      const g = Object.keys(granules)[0];
      t.is(granules[g].files.length, 2);
    }
    t.end(e);
  });
});

test.cb('test discovering mur granules with queue', (t) => {
  const newMur = Object.assign({}, mur);
  sinon.stub(queue, 'queueGranule').callsFake(() => true);

  // update discovery rule
  const rule = '/allData/ghrsst/data/GDS2/L4/GLOB/JPL/MUR/v4.1/2017/(20[1-3])';
  newMur.config.useQueue = true;
  newMur.config.collection.provider_path = rule;

  handler(newMur, {}, (e, output) => {
    if (e && e.message.includes('getaddrinfo ENOTFOUND')) {
      log.info('ignoring this test. Test server seems to be down');
    }
    else {
      t.is(output.granules_found, 3);
    }
    queue.queueGranule.restore();
    t.end(e);
  });
});

test.cb('test discovering amsr2 granules using SFTP', (t) => {
  if (!process.env.JAXA_HOST || !process.env.JAXA_PORT) {
    log.info('Skipping SFTP test because credentials are not set');
    t.end();
  }
  else {
    const payload = Object.assign({}, amsr2);
    payload.config.provider.host = process.env.JAXA_HOST;
    payload.config.provider.port = process.env.JAXA_PORT;
    payload.config.provider.username = process.env.JAXA_USER;
    payload.config.provider.password = process.env.JAXA_PASS;
    payload.config.provider.encrypted = true;

    // update discovery rule
    payload.config.useQueue = false;
    payload.input = {};

    handler(payload, {}, (e, output) => {
      const granules = output.granules;
      t.true(Object.keys(granules).length > 5);
      const g = Object.keys(granules)[0];
      t.is(granules[g].files.length, 1);
      t.end(e);
    });
  }
});

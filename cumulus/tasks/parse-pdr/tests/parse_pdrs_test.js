'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const modis = require('@cumulus/test-data/payloads/new-message-schema/parse.json');

const pdr = proxyquire('@cumulus/ingest/pdr', {
  '@cumulus/common/aws': {
    uploadS3Files: () => 's3://test-bucket/file'
  }
});

const handler = proxyquire('../index', {
  '@cumulus/common/ingest/pdr': {
    HttpParse: pdr.HttpParse
  }
}).handler;

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, modis);
  delete newPayload.config.provider;
  handler(newPayload, {}, (e) => {
    t.true(e instanceof errors.ProviderNotFound);
    t.end();
  });
});

test.cb('parse PDR from FTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const pdrName = 'MOD09GQ.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  handler(newPayload, {}, (e, output) => {
    if (e instanceof errors.RemoteResourceError || e.code === 'AllAccessDisabled') {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(output.granules.length, output.granulesCount);
    t.is(output.pdr.name, pdrName);
    t.is(output.filesCount, 2);
    return t.end(e);
  });
});

test.cb('parse PDR from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const pdrName = 'MOD09GQ.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  handler(newPayload, {}, (e, output) => {
    if (e instanceof errors.RemoteResourceError || e.code === 'AllAccessDisabled') {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(output.granules.length, output.granulesCount);
    t.is(output.pdr.name, pdrName);
    t.is(output.filesCount, 2);
    return t.end(e);
  });
});

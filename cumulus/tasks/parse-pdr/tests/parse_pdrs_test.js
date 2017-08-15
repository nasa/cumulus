'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const modis = require('@cumulus/test-data/payloads/modis/parse.json');

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
  delete newPayload.provider;
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

  const pdrName = 'PDN.ID1611071307.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.provider = provider;
  newPayload.payload = {
    pdr: {
      name: pdrName,
      path: '/pdrs'
    }
  };
  handler(newPayload, {}, (e, r) => {
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(r.payload.granules.length, r.payload.granulesCount);
    t.is(r.payload.pdr.name, pdrName);
    t.is(r.payload.filesCount, 8);
    return t.end(e);
  });
});

test.cb('parse PDR from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const pdrName = 'PDN.ID1611081200.PDR';

  const newPayload = Object.assign({}, modis);
  newPayload.provider = provider;
  newPayload.payload = {
    pdr: {
      name: pdrName,
      path: '/pdrs'
    }
  };
  handler(newPayload, {}, (e, r) => {
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(r.payload.granules.length, r.payload.granulesCount);
    t.is(r.payload.pdr.name, pdrName);
    t.is(r.payload.filesCount, 8);
    return t.end(e);
  });
});

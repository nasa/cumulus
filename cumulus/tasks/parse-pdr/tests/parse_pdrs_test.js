'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const errors = require('@cumulus/common/errors');
const payload = require('@cumulus/test-data/payloads/payload_ast_l1a.json');

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
  const newPayload = Object.assign({}, payload);
  delete newPayload.collection.provider;
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
    path: '/pdrs',
    username: 'testuser',
    password: 'testpass'
  };

  const pdrName = 'PDN.ID1611071307.PDR';

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = { pdrName, pdrPath: '/pdrs' };
  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.granules.length, r.payload.granulesCount);
    t.is(r.payload.pdrName, pdrName);
    t.is(r.payload.filesCount, 8);
    t.is(r.payload.granules[0].collectionName, 'AST_L1A');
    t.end(e);
  });
});

test.cb('parse PDR from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080',
    path: '/pdrs'
    //host: 'https://1eadb566.ngrok.io',
    //path: '/'

  };

  const pdrName = 'PDN.ID1611081200.PDR';

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {
    pdrName,
    pdrPath: '/pdrs'
  };

  handler(newPayload, {}, (e, r) => {
    console.log(e);
    t.is(r.payload.granules.length, r.payload.granulesCount);
    t.is(r.payload.pdrName, pdrName);
    t.is(r.payload.filesCount, 8);
    t.is(r.payload.granules[0].collectionName, 'AST_L1A');
    t.end(e);
  });
});

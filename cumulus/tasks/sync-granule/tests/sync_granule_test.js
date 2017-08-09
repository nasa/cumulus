'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const errors = require('@cumulus/common/errors');
const payload = require('@cumulus/test-data/payloads/payload_ast_l1a.json');

const granule = proxyquire('@cumulus/ingest/granule', {
  '@cumulus/common/aws': {
    uploadS3Files: () => 's3://test-bucket/file'
  }
});

const handler = proxyquire('../index', {
  '@cumulus/ingest/granule': {
    HttpGranule: granule.HttpGranule
  },
  '@cumulus/ingest/lock': {
    proceed: () => true,
    removeLock: () => true
  }
}).handler;

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, payload);
  delete newPayload.provider;
  handler(newPayload, {}, (e) => {
    t.true(e instanceof errors.ProviderNotFound);
    t.end();
  });
});

test.cb('download Granule from FTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    path: '/pdrs',
    username: 'testuser',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {
    pdrName: 'mypdr.pdr',
    granules: [{
      collectionName: 'AST_L1A',
      granuleId: '1A0000-2016121001_000_001',
      granuleSize: 84037,
      files: [
        {
          path: '/granules/',
          filename: 'pg-BR1A0000-2016121001_000_001',
          fileSize: 84037,
          checksumType: 'CKSUM',
          checksumValue: 3978529818
        }
      ]
    }]
  };
  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.input.AST_L1A.granules.length, 1);
    t.is(Object.keys(r.payload.input.AST_L1A.granules[0].files).length, 1);
    t.is(
      r.payload.input.AST_L1A.granules[0].files['origin-thumbnail'],
      's3://cumulus-generic-test-private/pg-BR1A0000-2016121001_000_001'
    );
    t.end(e);
  });
});

test.cb('download Granule from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080',
    path: '/pdrs'
    //host: 'https://1eadb566.ngrok.io',
    //path: '/'

  };

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {
    pdrName: 'mypdr.pdr',
    granules: [{
      collectionName: 'AST_L1A',
      granuleId: '1A0000-2016121001_000_001',
      granuleSize: 84037,
      files: [
        {
          path: '/granules/',
          filename: 'pg-BR1A0000-2016121001_000_001',
          fileSize: 84037,
          checksumType: 'CKSUM',
          checksumValue: 3978529818
        }
      ]
    }]
  };

  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.input.AST_L1A.granules.length, 1);
    t.is(Object.keys(r.payload.input.AST_L1A.granules[0].files).length, 1);
    t.is(
      r.payload.input.AST_L1A.granules[0].files['origin-thumbnail'],
      's3://cumulus-generic-test-private/pg-BR1A0000-2016121001_000_001'
    );
    t.end(e);
  });
});

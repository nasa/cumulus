'use strict';

const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const errors = require('@cumulus/common/errors');
const log = require('@cumulus/common/log');
const payload = require('@cumulus/test-data/payloads/modis/ingest.json');
const payloadChecksumFile = require('@cumulus/test-data/payloads/modis/ingest-checksumfile.json');
const S3 = require('@cumulus/ingest/aws').S3;

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
    username: 'testuser',
    password: 'testpass'
  };

  sinon.stub(S3, 'fileExists').callsFake(() => false);
  sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  handler(newPayload, {}, (e, r) => {
    S3.fileExists.restore();
    S3.upload.restore();
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }

    t.is(r.payload.granules.length, 1);
    t.is(r.payload.granules[0].files.length, 1);
    t.is(
      r.payload.granules[0].files[0].filename,
      's3://cumulus-protected/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf'
    );
    return t.end(e);
  });
});

test.cb('download Granule from HTTP endpoint', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  sinon.stub(S3, 'fileExists').callsFake(() => false);
  sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  handler(newPayload, {}, (e, r) => {
    S3.fileExists.restore();
    S3.upload.restore();
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }

    t.is(r.payload.granules.length, 1);
    t.is(r.payload.granules[0].files.length, 1);
    t.is(
      r.payload.granules[0].files[0].filename,
      's3://cumulus-protected/MOD09GQ.A2017224.h27v08.006.2017227165029.hdf'
    );
    return t.end(e);
  });
});

test.cb('download Granule with checksum in file', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  sinon.stub(S3, 'fileExists').callsFake(() => false);
  sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

  const newPayload = Object.assign({}, payloadChecksumFile);
  newPayload.provider = provider;
  handler(newPayload, {}, (e, r) => {
    S3.fileExists.restore();
    S3.upload.restore();
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }

    t.is(r.payload.granules.length, 1);
    t.is(r.payload.granules[0].files.length, 1);
    t.is(
    r.payload.granules[0].files[0].filename,
      's3://cumulus-private/20160115-MODIS_T-JPL-L2P-T2016015000000.L2_LAC_GHRSST_N-v01.nc.bz2'
    );
    return t.end(e);
  });
});

test.cb('replace duplicate Granule', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };
  sinon.stub(S3, 'fileExists').callsFake(() => true);
  var uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  handler(newPayload, {}, (e, r) => {
    S3.fileExists.restore();
    S3.upload.restore();
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.true(uploaded.called);
    return t.end(e);
  });
});

test.cb('skip duplicate Granule', (t) => {
  sinon.stub(S3, 'fileExists').callsFake(() => true);
  var uploaded = sinon.stub(S3, 'upload').callsFake(() => '/test/test.hd');

  const newPayload = Object.assign({}, payload);
  newPayload.collection.meta.granuleHandling = "skip";
  handler(newPayload, {}, (e, r) => {
    S3.fileExists.restore();
    S3.upload.restore();
    if (e instanceof errors.RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.false(uploaded.called);
    return t.end(e);
  });
});

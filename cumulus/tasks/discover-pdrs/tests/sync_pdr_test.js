'use strict';

const test = require('ava');
const path = require('path');
const sinon = require('sinon');
const {
  ProviderNotFound,
  FTPError,
  RemoteResourceError
} = require('@cumulus/common/errors');
const { S3 } = require('@cumulus/ingest/aws');
const log = require('@cumulus/common/log');

const { handler } = require('../index');
const input = require('./fixtures/input.json');

const aws = require('@cumulus/common/aws');
const testUtils = require('@cumulus/common/test-utils');

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, input);
  delete newPayload.config.provider;
  handler(newPayload, {}, (e) => {
    t.true(e instanceof ProviderNotFound);
    t.end();
  });
});

test.cb('test pdr discovery with FTP assuming all PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': false,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.config.collection.provider_path = '/pdrs';
  newPayload.config.useQueue = false;
  newPayload.input = {};

  handler(newPayload, {}, (e, output) => {
    S3.fileExists.restore();
    if (e instanceof RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(output.pdrs.length, 4);
    return t.end(e);
  });
});

test.cb('test pdr discovery with FTP invalid user/pass', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.input = {};
  handler(newPayload, {}, (e) => {
    if (e instanceof RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      t.end();
    }
    else {
      t.true(e instanceof FTPError);
      t.true(e.message.includes('Login incorrect'));
      t.end();
    }
  });
});

test.cb('test pdr discovery with FTP connection refused', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    port: '30', // using port that doesn't exist to nonresponsiveness
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.input = {};
  handler(newPayload, {}, (e) => {
    t.true(e instanceof RemoteResourceError);
    t.end();
  });
});

test.cb('test pdr discovery with FTP assuming some PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  newPayload.config.collection.provider_path = '/pdrs';
  newPayload.input = {};

  const internalBucketName = testUtils.randomString();
  newPayload.config.buckets.internal = internalBucketName;
  aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => {
      const Key = [
        newPayload.config.stack,
        newPayload.config.collection.provider_path.replace(/^\//, ''),
        'PDN.ID1611071307.PDR'
      ].join('/');

      return aws.s3().putObject({
        Bucket: internalBucketName,
        Key,
        Body: 'PDN.ID1611071307.PDR'
      }).promise();
    })
    .then(() => handler(newPayload, {}, (e, output) => {
      if (e) {
        if (e instanceof RemoteResourceError) {
          log.info('ignoring this test. Test server seems to be down');
          return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
        }
        return aws.recursivelyDeleteS3Bucket(internalBucketName)
          .then(() => t.end(e));
      }

      t.is(output.pdrs.length, 3);
      return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
    }));
});

test.cb('test pdr discovery with HTTP assuming some PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  newPayload.config.collection.provider_path = '/';
  newPayload.input = {};

  const internalBucketName = testUtils.randomString();
  newPayload.config.buckets.internal = internalBucketName;
  aws.s3().createBucket({ Bucket: internalBucketName }).promise()
    .then(() => aws.s3().putObject({
      Bucket: internalBucketName,
      Key: 'lpdaac-cumulus-phaseIII/pdrs/pdrs/PDN.ID1611071307.PDR',
      Body: 'PDN.ID1611071307.PDR'
    }).promise())
    .then(() => handler(newPayload, {}, (e, output) => {
      if (e) {
        if (e instanceof RemoteResourceError) {
          log.info('ignoring this test. Test server seems to be down');
          return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
        }
        return aws.recursivelyDeleteS3Bucket(internalBucketName)
          .then(() => t.end(e));
      }

      t.is(output.pdrs.length, 2);
      return aws.recursivelyDeleteS3Bucket(internalBucketName).then(t.end);
    }));
});

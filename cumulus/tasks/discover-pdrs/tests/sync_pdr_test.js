'use strict';

import test from 'ava';
import path from 'path';
import sinon from 'sinon';
import {
  ProviderNotFound,
  FTPError,
  RemoteResourceError
} from '@cumulus/common/errors';
import { S3 } from '@cumulus/ingest/aws';
import log from '@cumulus/common/log';

import { handler } from '../index';
import input from './fixtures/input.json';

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
  newPayload.config.collection.meta.provider_path = '/pdrs';
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

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': true,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  newPayload.config.collection.meta.provider_path = '/pdrs';
  newPayload.input = {};
  handler(newPayload, {}, (e, output) => {
    S3.fileExists.restore();
    if (e instanceof RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(output.pdrs.length, 3);
    return t.end(e);
  });
});

test.cb('test pdr discovery with HTTP assuming some PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080'
  };

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': true,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, input);
  newPayload.config.provider = provider;
  newPayload.config.useQueue = false;
  newPayload.config.collection.meta.provider_path = '/';
  newPayload.input = {};
  handler(newPayload, {}, (e, output) => {
    S3.fileExists.restore();
    if (e instanceof RemoteResourceError) {
      log.info('ignoring this test. Test server seems to be down');
      return t.end();
    }
    t.is(output.pdrs.length, 2);
    return t.end(e);
  });
});

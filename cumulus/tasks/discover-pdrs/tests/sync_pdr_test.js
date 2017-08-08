'use strict';

import test from 'ava';
import path from 'path';
import sinon from 'sinon';
import { ProviderNotFound, FTPError } from '@cumulus/common/errors';
import payload from '@cumulus/test-data/payloads/payload_ast_l1a.json';
import { S3 } from '@cumulus/common/aws-helpers';
import { handler } from '../index';

test.cb('error when provider info is missing', (t) => {
  const newPayload = Object.assign({}, payload);
  delete newPayload.provider;
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
    path: '/pdrs',
    username: 'testuser',
    password: 'testpass'
  };

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': false,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {};
  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.pdrs.length, 3);
    t.end(e);
    S3.fileExists.restore();
  });
});

test.cb('test pdr discovery with FTP invalid user/pass', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    path: '/pdrs',
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {};
  handler(newPayload, {}, (e) => {
    t.true(e instanceof FTPError);
    t.true(e.message.includes('Login incorrect'));
    t.end();
  });
});

test.cb('test pdr discovery with FTP connection refused', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    port: '30', // using port that doesn't exist to nonresponsiveness
    path: '/pdrs',
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {};
  handler(newPayload, {}, (e) => {
    t.true(e instanceof FTPError);
    t.true(e.message.includes('ECONNREFUSED'));
    t.end();
  });
});

test.cb('test pdr discovery with FTP assuming some PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    path: '/pdrs',
    username: 'testuser',
    password: 'testpass'
  };

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': true,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {};
  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.pdrs.length, 2);
    t.end(e);
    S3.fileExists.restore();
  });
});

test.cb('test pdr discovery with HTTP assuming some PDRs are new', (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:8080',
    path: '/'
  };

  const ps = {
    'MYD13A1_5_grans.PDR': false,
    'PDN.ID1611071307.PDR': true,
    'PDN.ID1611081200.PDR': false
  };

  sinon.stub(S3, 'fileExists').callsFake((b, k) => ps[path.basename(k)]);

  const newPayload = Object.assign({}, payload);
  newPayload.provider = provider;
  newPayload.payload = {};
  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.pdrs.length, 2);
    t.end(e);
    S3.fileExists.restore();
  });
});

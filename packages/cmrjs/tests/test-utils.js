'use strict';

const sinon = require('sinon');
const test = require('ava');
const publicIp = require('public-ip');

const {
  getIp,
  ummVersionToMetadataFormat
} = require('../utils');

test.afterEach((t) => {
  const { stub } = t.context;
  if (stub !== undefined) stub.restore();
});

test.serial('getIp returns public IP when available', async (t) => {
  const fakeIp = '192.0.2.3';
  t.context.stub = sinon.stub(publicIp, 'v4').resolves(fakeIp);
  t.is(await getIp(), fakeIp);
});

test.serial('getIp returns fallback IP when no public IP is available', async (t) => {
  const fallbackIp = '10.0.0.0';
  t.context.stub = sinon.stub(publicIp, 'v4').rejects(new Error('Query timed out'));
  t.is(await getIp(), fallbackIp);
});

test.serial('getIp throws an error when the error is unexpected', async (t) => {
  const errorMessage = 'Server is experiencing an identity crisis';
  t.context.stub = sinon.stub(publicIp, 'v4').rejects(new Error(errorMessage));
  await getIp().catch((error) => {
    t.is(error.message, errorMessage);
  });
});

test('ummVersionToMetadataFormat returns correct metadata format for UMM-G versions', (t) => {
  let actual = ummVersionToMetadataFormat('1.4');
  t.is('umm_json_v1_4', actual);

  actual = ummVersionToMetadataFormat('1.5');
  t.is('umm_json_v1_5', actual);
});

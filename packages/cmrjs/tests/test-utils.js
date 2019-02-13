'use strict';

const sinon = require('sinon');
const test = require('ava');
const publicIp = require('public-ip');

const {
  getIp,
  getHost,
  hostId,
  ummVersion
} = require('../utils');

let stub;

test.afterEach(() => {
  if (stub !== undefined) stub.restore();
});

test('getIp returns public IP when available', async (t) => {
  const fakeIp = '123.456.78.9';
  stub = sinon.stub(publicIp, 'v4').resolves(fakeIp);
  t.is(await getIp(), fakeIp);
});

test('getIp returns fallback IP when no public IP is available', async (t) => {
  const fallbackIp = '10.0.0.0';
  stub = sinon.stub(publicIp, 'v4').rejects(new Error('Query timed out'));
  t.is(await getIp(), fallbackIp);
});

test('getIp throws an error when the error is unexpected', async (t) => {
  const errorMessage = 'Server is experiencing an identity crisis';
  stub = sinon.stub(publicIp, 'v4').rejects(new Error(errorMessage));
  await getIp().catch((error) => {
    t.is(error.message, errorMessage);
  });
});

test('getHost returns value according to process.env.CMR_ENVIRONMENT', (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  t.is(getHost(), 'cmr.earthdata.nasa.gov');
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getHost(), 'cmr.sit.earthdata.nasa.gov');
  process.env.CMR_ENVIRONMENT = '';
  t.is(getHost(), 'cmr.uat.earthdata.nasa.gov');
});

test('getHost returns value according passed parameter', (t) => {
  const param = { CMR_ENVIRONMENT: 'OPS' };
  t.is(getHost(param), 'cmr.earthdata.nasa.gov');
  param.CMR_ENVIRONMENT = 'SIT';
  t.is(getHost(param), 'cmr.sit.earthdata.nasa.gov');
  param.CMR_ENVIRONMENT = 'literally anything else';
  t.is(getHost(param), 'cmr.uat.earthdata.nasa.gov');
});

test('hostId returns expected pieces of cmr url', (t) => {
  let env = 'OPS';
  t.is(hostId(env), '');
  env = 'SIT';
  t.is(hostId(env), 'sit');
  env = 'any other thing';
  t.is(hostId(env), 'uat');
});

test('getHost returns CMR_HOST when defined', (t) => {
  const anotherHost = 'cmr.com';
  process.env.CMR_HOST = anotherHost;
  t.is(getHost(), anotherHost);
});

test('ummVersion returns UMM version if found on metadata object.', (t) => {
  const metadata = {
    restOfMetadataUpHere: 'it is all fake',
    MetadataSpecification: {
      URL: 'https://cdn.earthdata.nasa.gov/umm/granule/v1.5',
      Name: 'UMM-G',
      Version: '1.5'
    }
  };

  const actual = ummVersion(metadata);

  t.is('1.5', actual);
});

test('ummVersion returns default version 1.4 if object has no metadata specification.', (t) => {
  const metadata = {
    restOfMetadataUpHere: 'still fake',
    MissingMetadataSpecification: 'nothing here'
  };

  const actual = ummVersion(metadata);

  t.is('1.4', actual);
});

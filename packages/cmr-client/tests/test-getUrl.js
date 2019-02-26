'use strict';

const test = require('ava');

const { getHost, hostId } = require('../getUrl');

test.serial('getHost returns value according to process.env.CMR_ENVIRONMENT', (t) => {
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

test.serial('getHost returns CMR_HOST when defined', (t) => {
  const anotherHost = 'cmr.com';
  process.env.CMR_HOST = anotherHost;
  t.is(getHost(), anotherHost);
  delete process.env.CMR_HOST;
});

test('hostId returns expected pieces of cmr url', (t) => {
  let env = 'OPS';
  t.is(hostId(env), '');
  env = 'SIT';
  t.is(hostId(env), 'sit');
  env = 'any other thing';
  t.is(hostId(env), 'uat');
});

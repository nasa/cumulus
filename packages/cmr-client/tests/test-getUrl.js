'use strict';

const test = require('ava');

const { getCmrHost, getSearchUrl } = require('../getUrl');

test('getCmrHost uses provided logical CMR environment', (t) => {
  t.is(getCmrHost('OPS'), 'cmr.earthdata.nasa.gov');
  t.is(getCmrHost('UAT'), 'cmr.uat.earthdata.nasa.gov');
  t.is(getCmrHost('SIT'), 'cmr.sit.earthdata.nasa.gov');
});

test('getCmrHost uses custom CMR environment', (t) => {
  t.is(getCmrHost('custom-host'), 'custom-host');
});

test('getCmrHost throws error if provided environment is falsy', (t) => {
  t.throws(() => getCmrHost());
  // eslint-disable-next-line unicorn/no-null
  t.throws(() => getCmrHost(null));
});

test.serial('getCmrHost uses process.env.CMR_ENVIRONMENT logical name, if provided', (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);
  t.is(getCmrHost(), 'cmr.earthdata.nasa.gov');
});

test.serial('getCmrHost uses process.env.CMR_ENVIRONMENT custom host, if provided', (t) => {
  process.env.CMR_ENVIRONMENT = 'cmr-host';
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);
  t.is(getCmrHost(), 'cmr-host');
});

test.serial('getSearchUrl returns value according to cmrEnvironment param', (t) => {
  t.is(getSearchUrl({ cmrEnv: 'OPS' }), 'https://cmr.earthdata.nasa.gov/search/');
  t.is(getSearchUrl({ cmrEnv: 'SIT' }), 'https://cmr.sit.earthdata.nasa.gov/search/');
  t.is(getSearchUrl({ cmrEnv: 'UAT' }), 'https://cmr.uat.earthdata.nasa.gov/search/');
});

test.serial('getSearchUrl pulls cmrEnvironment from environment variables', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getSearchUrl(), 'https://cmr.sit.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'UAT';
  t.is(getSearchUrl(), 'https://cmr.uat.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'OPS';
  t.is(getSearchUrl(), 'https://cmr.earthdata.nasa.gov/search/');

  t.teardown(() => delete process.env.CMR_ENVIRONMENT);
});

test.serial('getSearchUrl uses cmrEnv from parameter over env variable', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getSearchUrl({ cmrEnv: 'OPS' }), 'https://cmr.earthdata.nasa.gov/search/');
  t.teardown(() => delete process.env.CMR_ENVIRONMENT);
});

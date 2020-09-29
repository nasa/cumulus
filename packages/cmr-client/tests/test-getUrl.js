'use strict';

const test = require('ava');

const { getSearchUrl } = require('../getUrl');

test.serial('getSearchUrl returns value according to cmrEnvironment param', (t) => {
  t.is(getSearchUrl({ cmrEnv: 'OPS' }), 'https://cmr.earthdata.nasa.gov/search/');
  t.is(getSearchUrl({ cmrEnv: 'SIT' }), 'https://cmr.sit.earthdata.nasa.gov/search/');
  t.is(getSearchUrl({ cmrEnv: 'UAT' }), 'https://cmr.uat.earthdata.nasa.gov/search/');
});

test.serial('getUrl pulls cmrEnvironment from environment variables', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getSearchUrl(), 'https://cmr.sit.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'UAT';
  t.is(getSearchUrl(), 'https://cmr.uat.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'OPS';
  t.is(getSearchUrl(), 'https://cmr.earthdata.nasa.gov/search/');
});

test.serial('getUrl uses cmrEnv from parameter over env variable', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getSearchUrl({ cmrEnv: 'OPS' }), 'https://cmr.earthdata.nasa.gov/search/');
});

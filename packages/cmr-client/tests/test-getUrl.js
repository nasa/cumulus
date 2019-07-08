'use strict';

const test = require('ava');

const getUrl = require('../getUrl');

test.serial('getUrl returns value according to cmrEnvironment param', (t) => {
  t.is(getUrl('search', null, 'OPS'), 'https://cmr.earthdata.nasa.gov/search/');
  t.is(getUrl('search', null, 'SIT'), 'https://cmr.sit.earthdata.nasa.gov/search/');
  t.is(getUrl('search', null, 'UAT'), 'https://cmr.uat.earthdata.nasa.gov/search/');
});

test.serial('getUrl pulls cmrEnvironment from environment variables', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getUrl('search'), 'https://cmr.sit.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'UAT';
  t.is(getUrl('search'), 'https://cmr.uat.earthdata.nasa.gov/search/');

  process.env.CMR_ENVIRONMENT = 'OPS';
  t.is(getUrl('search'), 'https://cmr.earthdata.nasa.gov/search/');
});

test.serial('getUrl uses cmrEnv from parameter over env variable', (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getUrl('search', null, 'OPS'), 'https://cmr.earthdata.nasa.gov/search/');
});

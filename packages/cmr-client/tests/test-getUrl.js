'use strict';

const test = require('ava');

const getUrl = require('../getUrl');

test.serial('getUrl returns value according to process.env.CMR_ENVIRONMENT', (t) => {
  process.env.CMR_ENVIRONMENT = 'OPS';
  t.is(getUrl('search'), 'https://cmr.earthdata.nasa.gov/search/');
  process.env.CMR_ENVIRONMENT = 'SIT';
  t.is(getUrl('search'), 'https://cmr.sit.earthdata.nasa.gov/search/');
  process.env.CMR_ENVIRONMENT = '';
  t.is(getUrl('search'), 'https://cmr.uat.earthdata.nasa.gov/search/');
});

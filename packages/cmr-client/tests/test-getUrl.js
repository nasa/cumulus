'use strict';

const test = require('ava');

const getUrl = require('../getUrl');

test.serial('getUrl returns value according to cmrEnvironment param', (t) => {
  t.is(getUrl('search', null, 'OPS'), 'https://cmr.earthdata.nasa.gov/search/');
  t.is(getUrl('search', null, 'SIT'), 'https://cmr.sit.earthdata.nasa.gov/search/');
  t.is(getUrl('search'), 'https://cmr.uat.earthdata.nasa.gov/search/');
});

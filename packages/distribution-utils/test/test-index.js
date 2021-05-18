'use strict';

const test = require('ava');

const { MissingBucketMap } = require('@cumulus/errors');

const { constructDistributionUrl } = require('..');

test('constructDistributionUrl returns distribution URL', (t) => {
  const fileBucket = 'abcd1234';
  const fileKey = 'coll123/granABC';
  const distEndpoint = 'https://cumulus-distribution.nasa.gov/';
  const bucketMap = {
    abcd1234: 'prod1A2B',
  };
  t.is(
    constructDistributionUrl(fileBucket, fileKey, distEndpoint, bucketMap),
    'https://cumulus-distribution.nasa.gov/prod1A2B/coll123/granABC'
  );
});

test('constructDistributionUrl throws error if no bucketPath can be found', (t) => {
  const fileBucket = 'abcd1234';
  const fileKey = 'coll123/granABC';
  const distEndpoint = 'https://cumulus-distribution.nasa.gov/';
  t.throws(
    () => constructDistributionUrl(fileBucket, fileKey, distEndpoint, {}),
    {
      instanceOf: MissingBucketMap,
    }
  );
});

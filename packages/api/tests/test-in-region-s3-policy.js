'use strict';

const test = require('ava');
const sinon = require('sinon');
const get = require('lodash.get');

const policy = require('../lambdas/in-region-s3-policy');

test.beforeEach(() => {
  const ipResponse = [
    {
      ip_prefix: '192.0.2.3',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '192.0.2.3',
      region: 'us-west-2',
      service: 'AMAZON'
    },
    {
      ip_prefix: '192.0.2.3',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '192.0.2.3',
      region: 'ap-northeast-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '192.0.2.32',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '192.0.2.3',
      region: 'us-west-2',
      service: 'AMAZON'
    }
  ];

  sinon.stub(
    policy,
    'getIpRanges'
  ).resolves(ipResponse);
});

test.afterEach(() => {
  policy.getIpRanges.restore();
});

test.serial('IP ranges filtered correctly', async (t) => {
  const bucketPolicy = await policy.generatePolicy('url', 'us-east-1', 'test-bucket');

  t.deepEqual(
    get(bucketPolicy, 'Statement[0].Condition.IpAddress.aws:SourceIp'),
    ['192.0.2.3', '192.0.2.3', '192.0.2.32']
  );
});

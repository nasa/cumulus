'use strict';

const test = require('ava');
const sinon = require('sinon');
const get = require('lodash.get');

const policy = require('../../lambdas/in-region-s3-policy');

test.beforeEach(() => {
  const ipResponse = [
    {
      ip_prefix: '18.232.0.0/14',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '18.236.0.0/15',
      region: 'us-west-2',
      service: 'AMAZON'
    },
    {
      ip_prefix: '23.20.0.0/14',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '27.0.0.0/22',
      region: 'ap-northeast-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '34.192.0.0/12',
      region: 'us-east-1',
      service: 'AMAZON'
    },
    {
      ip_prefix: '34.208.0.0/12',
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
    ['18.232.0.0/14', '23.20.0.0/14', '34.192.0.0/12']
  );
});

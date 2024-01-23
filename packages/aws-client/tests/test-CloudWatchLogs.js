'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const { cloudwatchlogs } = require('../services');

test('createLogGroup() and deleteLogGroup create and delete the log group', async (t) => {
  const logGroupName = `prefix-${cryptoRandomString({ length: 10 })}`;
  const result = await cloudwatchlogs().createLogGroup({ logGroupName });
  t.is(result.$metadata.httpStatusCode, 200);
  const description = await cloudwatchlogs().describeLogGroups({
    logGroupNamePattern: logGroupName,
  });
  t.is(description.logGroups.length, 1);
  t.is(description.logGroups[0].logGroupName, logGroupName);
  await cloudwatchlogs().deleteLogGroup({ logGroupName });
  t.is(result.$metadata.httpStatusCode, 200);
  const descriptionPostDelete = await cloudwatchlogs().describeLogGroups({
    logGroupNamePattern: logGroupName,
  });
  t.is(descriptionPostDelete.logGroups.length, 0);
});

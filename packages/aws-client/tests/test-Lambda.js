'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const range = require('lodash/range');
const Lambda = require('../Lambda');
const { lambda } = require('../services');
const { sleep } = require('../../common');

const randomString = () => cryptoRandomString({ length: 10 });

test.serial('create, invoke and delete function', async (t) => {
  const functionName = randomString();
  const lambdaFunction = await lambda().createFunction({
    Code: {
      ZipFile: fs.readFileSync(require.resolve('@cumulus/test-data/fake-lambdas/hello.zip')),
    },
    FunctionName: functionName,
    Role: `arn:aws:iam::123456789012:role/${randomString()}`,
    Handler: 'index.handler',
    Runtime: 'nodejs16.x',
  });
  t.is(lambdaFunction.FunctionName, functionName);
  const unittestResponse = await Lambda.invoke(lambdaFunction.FunctionName, {});
  t.is(unittestResponse, undefined);
  // this delete can, rarely, fail because a function "doesn't exist"
  // even though it was just invoked successfully. trying again in a second
  // almost always fixes this
  for (const i of range(10)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await lambda().deleteFunction({ FunctionName: functionName });
      break;
    } catch (error) {
      console.log(`delete failed with error ${error}, trying again for the ${i}th time`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
  }
});

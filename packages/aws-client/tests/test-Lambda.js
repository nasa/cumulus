'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const Lambda = require('../Lambda');
const { lambda } = require('../services');

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
  t.false(unittestResponse);
  await lambda().deleteFunction({ FunctionName: functionName });
});

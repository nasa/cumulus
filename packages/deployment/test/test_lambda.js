
/* eslint-disable no-console, no-param-reassign */

'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const test = require('ava');

const Lambda = require('../lib/lambda');
const { fetchMessageAdapter } = require('../lib/adapter');

const gitPath = 'nasa/cumulus-message-adapter';
const zipFixturePath = 'test/fixtures/zipfile-fixture.zip';
const zipFixtureSize = fs.statSync(zipFixturePath).size;

test.beforeEach(async (t) => {
  t.context.temp = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
  fs.mkdirSync(path.join(t.context.temp, 'build'));
  fs.mkdirSync(path.join(t.context.temp, 'build', 'cloudformation'));
  t.context.adaptersrc = path.join(t.context.temp, 'build', 'cumulus-message-adapter.zip');
  t.context.adapterdest = path.join(t.context.temp, 'build', 'adapter');
  t.context.config = {
    kesFolder: t.context.temp,
    cfFile: 'app/cloudformation.template.yml',
    configFile: 'app/config.yml',
    bucket: 'testbucket',
    stack: 'teststack'
  };
  t.context.lambda = {
    handler: 'index.handler',
    name: 'lambda-example',
    fullName: 'teststack-lambda-example',
    local: path.join(
      t.context.temp,
      'build', 'cloudformation', 'b0174f8ae0abc4ef3f9735deeb5e0b05233dfdfc-lambda-example.zip'
    ),
    remote: path.join(
      t.context.config.stack,
      'lambdas', 'b0174f8ae0abc4ef3f9735deeb5e0b05233dfdfc-lambda-example.zip'
    ),
    source: 'test/fixtures/lambda-example',
    hash: 'b0174f8ae0abc4ef3f9735deeb5e0b05233dfdfc',
    bucket: 'testbucket'
  };

  await fetchMessageAdapter(
    null,
    gitPath,
    'cumulus-message-adapter.zip',
    t.context.adaptersrc,
    t.context.adapterdest
  );
  // getHash returns different value if the file is in different directory, so we run tests serially
  Lambda.messageAdapterZipFileHash = new Lambda(t.context.config).getHash(t.context.adaptersrc);
});

test.afterEach.always('cleanup temp directory', async (t) => {
  await fs.remove(t.context.temp);
});

test.serial('zipLambda: works for lambda not using message adapter', async (t) => {
  t.context.lambda.useMessageAdapter = false;
  const lambdaLocalOrigin = t.context.lambda.local;
  const lambdaRemoteOrigin = t.context.lambda.remote;
  const testLambda = new Lambda(t.context.config);
  await testLambda.zipLambda(testLambda.buildS3Path(t.context.lambda));
  t.truthy(fs.statSync(t.context.lambda.local));
  t.is(t.context.lambda.local, lambdaLocalOrigin);
  t.is(t.context.lambda.remote, lambdaRemoteOrigin);
});

test.serial('zipLambda: works for lambda using message adapter', async (t) => {
  t.context.lambda.useMessageAdapter = true;
  const lambdaLocalOrigin = t.context.lambda.local;
  const lambdaRemoteOrigin = t.context.lambda.remote;
  const testLambda = new Lambda(t.context.config);
  await testLambda.zipLambda(testLambda.buildS3Path(t.context.lambda));
  t.truthy(fs.statSync(t.context.lambda.local));
  t.is(
    path.basename(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaLocalOrigin)}`
  );
  t.is(
    path.basename(t.context.lambda.remote),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaRemoteOrigin)}`
  );
});

test.serial('zipLambda: given an invalid zip file generated from a previous run, a new valid lambda file is generated', async (t) => { // eslint-disable-line max-len
  t.context.lambda.useMessageAdapter = true;
  const lambdaLocalOrigin = t.context.lambda.local;
  const lambdaRemoteOrigin = t.context.lambda.remote;

  // put an empty lambda zip file there as the result of the previous run
  const existingLambdaLocal = path.join(
    path.dirname(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(t.context.lambda.local)}`
  );

  await fs.writeFile(existingLambdaLocal, 'hello');
  t.is(fs.statSync(existingLambdaLocal).size, 5);

  const testLambda = new Lambda(t.context.config);
  await testLambda.zipLambda(testLambda.buildS3Path(t.context.lambda));
  t.truthy(fs.statSync(t.context.lambda.local));
  t.true(fs.statSync(t.context.lambda.local).size > 5);
  t.is(t.context.lambda.local, existingLambdaLocal);

  t.is(
    path.basename(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaLocalOrigin)}`
  );
  t.is(
    path.basename(t.context.lambda.remote),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaRemoteOrigin)}`
  );
});


test.serial('zipLambda: for lambda using message adapter, no new file is generated if the task and message adapter are not updated', async (t) => { // eslint-disable-line max-len
  t.context.lambda.useMessageAdapter = true;

  // put a lambda zip file there as the result of the previous run
  const existingLambdaLocal = path.join(
    path.dirname(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(t.context.lambda.local)}`
  );

  const existingLambdaRemote = path.join(
    path.dirname(t.context.lambda.remote),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(t.context.lambda.remote)}`
  );

  await fs.copy(zipFixturePath, existingLambdaLocal);
  t.is(fs.statSync(existingLambdaLocal).size, zipFixtureSize);

  const testLambda = new Lambda(t.context.config);
  await testLambda.zipLambda(testLambda.buildS3Path(t.context.lambda));
  t.truthy(fs.statSync(t.context.lambda.local));
  t.is(fs.statSync(t.context.lambda.local).size, zipFixtureSize);
  t.is(t.context.lambda.local, existingLambdaLocal);
  t.is(t.context.lambda.remote, existingLambdaRemote);
});

test.serial('zipLambda: for lambda using message adapter, a new file is created if the message adapter is updated', async (t) => { // eslint-disable-line max-len
  t.context.lambda.useMessageAdapter = true;
  const lambdaLocalOrigin = t.context.lambda.local;
  const lambdaRemoteOrigin = t.context.lambda.remote;

  // put an empty lambda zip file there as the result of the previous run
  const existingLambdaLocal = path.join(
    path.dirname(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(t.context.lambda.local)}`
  );

  await fs.writeFile(existingLambdaLocal, 'hello');
  t.is(fs.statSync(existingLambdaLocal).size, 5);

  // message adapter is updated, a new lambda zip file is generated
  const adapterHashOrigin = Lambda.messageAdapterZipFileHash;
  Lambda.messageAdapterZipFileHash = `${adapterHashOrigin}123`;

  const testLambda = new Lambda(t.context.config);
  await testLambda.zipLambda(testLambda.buildS3Path(t.context.lambda));
  t.truthy(fs.statSync(t.context.lambda.local));
  t.true(fs.statSync(t.context.lambda.local).size > 5);
  t.not(t.context.lambda.local, existingLambdaLocal);

  t.is(
    path.basename(t.context.lambda.local),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaLocalOrigin)}`
  );
  t.is(
    path.basename(t.context.lambda.remote),
    `${Lambda.messageAdapterZipFileHash}-${path.basename(lambdaRemoteOrigin)}`
  );
});

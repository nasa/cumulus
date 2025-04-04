'use strict';

const cloneDeep = require('lodash/cloneDeep');
const fs = require('fs');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const pickAll = require('lodash/fp/pickAll');

const { sleep } = require('@cumulus/common');
const cmrClient = require('@cumulus/cmr-client');
const awsServices = require('@cumulus/aws-client/services');
const {
  createBucket,
  buildS3Uri,
  promiseS3Upload,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const { randomString, validateInput, validateConfig, validateOutput } = require('@cumulus/common/test-utils');
const { CMRMetaFileNotFound, CMRInternalError } = require('@cumulus/errors');
const launchpad = require('@cumulus/launchpad-auth');

const { postToCMR } = require('..');

const result = {
  'concept-id': 'G1222482316-CUMULUS',
};
const resultThunk = () => ({ result });

test.before(async (t) => {
  // Store the CMR password
  t.context.cmrPasswordSecretName = randomString();
  await awsServices.secretsManager().createSecret({
    Name: t.context.cmrPasswordSecretName,
    SecretString: randomString(),
  });

  // Store the Launchpad passphrase
  t.context.launchpadPassphraseSecretName = randomString();
  await awsServices.secretsManager().createSecret({
    Name: t.context.launchpadPassphraseSecretName,
    SecretString: randomString(),
  });
});

test.beforeEach(async (t) => {
  process.env.CMR_ENVIRONMENT = 'UAT';
  t.context.bucket = randomString();

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  const payload = JSON.parse(rawPayload);
  t.context.payload = payload;

  t.context.payload.config.cmr.passwordSecretName = t.context.cmrPasswordSecretName;
  t.context.payload.config.launchpad.passphraseSecretName = t.context.launchpadPassphraseSecretName;

  //update cmr file path
  payload.input.granules[0].files[3].bucket = t.context.bucket;

  await createBucket(t.context.bucket);
});

test.afterEach.always((t) => recursivelyDeleteS3Bucket(t.context.bucket));

test.after.always(async (t) => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: t.context.cmrPasswordSecretName,
    ForceDeleteWithoutRecovery: true,
  });
  await awsServices.secretsManager().deleteSecret({
    SecretId: t.context.launchpadPassphraseSecretName,
    ForceDeleteWithoutRecovery: true,
  });
});

test.serial('postToCMR throws error if CMR correctly identifies the xml as invalid', async (t) => {
  sinon.stub(cmrClient.CMR.prototype, 'getToken');

  const newPayload = cloneDeep(t.context.payload);

  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  const errorMessage = 'Failed to ingest, statusCode: 400, statusMessage: Bad Request, CMR error message: validation error';
  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').throws(new Error(errorMessage));
  t.teardown(() => {
    cmrClient.CMR.prototype.ingestGranule.restore();
  });

  await promiseS3Upload({
    params: {
      Bucket: t.context.bucket,
      Key: cmrFileKey,
      Body: '<?xml version="1.0" encoding="UTF-8"?><results></results>',
    },
  });
  try {
    await t.throwsAsync(postToCMR(newPayload),
      {
        name: 'Error',
        message: errorMessage,
      });
  } finally {
    cmrClient.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR fails to publish granules when CMR is down', async (t) => {
  sinon.stub(cmrClient.CMR.prototype, 'getToken');
  const { bucket, payload } = t.context;
  const newPayload = payload;
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').throws(new CMRInternalError());
  t.teardown(() => {
    cmrClient.CMR.prototype.ingestGranule.restore();
  });

  await s3PutObject({
    Bucket: bucket,
    Key: cmrFileKey,
    Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
  });
  try {
    await t.throwsAsync(postToCMR(newPayload),
      { instanceOf: CMRInternalError });
  } finally {
    cmrClient.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR fails to republish granules when CMR is down', async (t) => {
  sinon.stub(cmrClient.CMR.prototype, 'getToken');
  const newPayload = cloneDeep(t.context.payload);
  newPayload.config.republish = true;
  newPayload.config.concurrency = 2;
  newPayload.input.granules[0].published = true;
  newPayload.input.granules[0].cmrLink = randomString;

  sinon.stub(cmrClient.CMR.prototype, 'deleteGranule').throws(new CMRInternalError());
  t.teardown(() => {
    cmrClient.CMR.prototype.deleteGranule.restore();
  });

  try {
    await t.throwsAsync(postToCMR(newPayload),
      { instanceOf: CMRInternalError });
  } finally {
    cmrClient.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR raises correct error', async (t) => {
  sinon.stub(cmrClient.CMR.prototype, 'getToken');
  const { bucket, payload } = t.context;
  const newPayload = payload;
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').throws(new Error());
  t.teardown(() => {
    cmrClient.CMR.prototype.ingestGranule.restore();
  });

  await s3PutObject({
    Bucket: bucket,
    Key: cmrFileKey,
    Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
  });
  try {
    await t.throwsAsync(postToCMR(newPayload),
      { instanceOf: Error });
  } finally {
    cmrClient.CMR.prototype.getToken.restore();
  }
});

test.serial('postToCMR succeeds with correct payload', async (t) => {
  const { bucket, payload } = t.context;
  const newPayload = payload;
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);
  t.teardown(() => {
    cmrClient.CMR.prototype.ingestGranule.restore();
  });

  await s3PutObject({
    Bucket: bucket,
    Key: cmrFileKey,
    Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
  });

  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);
  const output = await postToCMR(newPayload);
  await validateOutput(t, output);
  t.is(output.granules.length, 1);
  t.is(
    output.granules[0].cmrLink,
    `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
  );
  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.post_to_cmr_duration));
    t.true(g.post_to_cmr_duration >= 0);
  });
});

test.serial('postToCMR successfully republishes granules with correct payload', async (t) => {
  const { bucket, payload } = t.context;
  const newPayload = cloneDeep(payload);
  newPayload.config.concurrency = 2;
  newPayload.config.republish = true;
  newPayload.input.granules[0].published = true;
  newPayload.input.granules[0].cmrLink = randomString;

  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'deleteGranule');
  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);
  t.teardown(() => {
    cmrClient.CMR.prototype.deleteGranule.restore();
    cmrClient.CMR.prototype.ingestGranule.restore();
  });

  await s3PutObject({
    Bucket: bucket,
    Key: cmrFileKey,
    Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
  });

  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);
  const output = await postToCMR(newPayload);
  await validateOutput(t, output);
  t.is(output.granules.length, 1);
  t.is(
    output.granules[0].cmrLink,
    `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
  );
  output.granules.forEach((g) => {
    t.true(Number.isInteger(g.post_to_cmr_duration));
    t.true(g.post_to_cmr_duration >= 0);
  });
});

test.serial('postToCMR immediately succeeds using metadata file ETag', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    const { ETag: etag } = await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
      },
    });
    newPayload.config.etags[buildS3Uri(t.context.bucket, cmrFileKey)] = etag;

    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );

    output.granules.forEach((g) => {
      t.true(Number.isInteger(g.post_to_cmr_duration));
      t.true(g.post_to_cmr_duration >= 0);
    });
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR succeeds without etags config', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
      },
    });

    delete newPayload.config.etags;

    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);

    t.is(output.granules.length, 1);
    // t.is(output.etags[buildS3Uri(t.context.bucket, key)], etag);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );

    output.granules.forEach((g) => {
      t.true(Number.isInteger(g.post_to_cmr_duration));
      t.true(g.post_to_cmr_duration >= 0);
    });
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR eventually succeeds using metadata file ETag', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  const cmrXml = fs.readFileSync(path.join(path.dirname(__filename), 'data',
    'meta.xml'), 'utf8');
  // "Minify" the XML simply to make it differ from the original XML so that S3
  // treats them as different versions (i.e., generates different ETags)
  const updatedCmrXml = cmrXml.split('\n').join('');

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    // Upload updated XML to obtain the updated ETag so we can add it to the
    // input CMR file.
    const { ETag: newEtag } = await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: updatedCmrXml,
      },
    });

    // Upload "original" XML so that the updated XML is not initially available
    // to the postToCMR task.
    const { ETag: oldEtag } = await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: cmrXml,
      },
    });

    t.not(oldEtag, newEtag, 'ETags should be different');
    newPayload.config.etags[buildS3Uri(t.context.bucket, cmrFileKey)] = newEtag;

    // Invoke postToCMR and then upload the updated XML to test that postToCMR
    // will properly wait for the correct version of the CMR file to exist.
    const outputPromise = postToCMR(newPayload);
    await sleep(3000).then(promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: updatedCmrXml,
      },
    }));
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await outputPromise;
    await validateOutput(t, output);

    t.is(output.granules.length, 1);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );

    output.granules.forEach((g) => {
      t.true(Number.isInteger(g.post_to_cmr_duration));
      t.true(g.post_to_cmr_duration >= 0);
    });
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR fails with PreconditionFailure when such error is thrown while getting metadata object from CMR', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    const { ETag: etag } = await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: fs.createReadStream(path.join(path.dirname(__filename), 'data',
          'meta.xml')),
      },
    });
    newPayload.config.etags[buildS3Uri(t.context.bucket, cmrFileKey)] = etag;

    // We must simulate throwing a PreconditionFailed error from the function
    // metadataObjectFromCMRFile because LocalStack does not correctly do so
    // via the S3.getObject() method.  All we can do is make sure postToCMR
    // properly propagates the error from metadataObjectFromCMRFile (which will
    // originate indirectly from S3.getObject() when hitting AWS instead of
    // LocalStack).
    const errorSelector = {
      code: 'PreconditionFailed',
      statusCode: 412,
    };
    const { postToCMR: postToCMR_ } = proxyquire('..', {
      '@cumulus/cmrjs': {
        metadataObjectFromCMRFile: () => {
          throw Object.assign(new Error(), errorSelector);
        },
      },
    });
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const error = await t.throwsAsync(postToCMR_(newPayload));

    t.deepEqual(pickAll(Object.keys(errorSelector), error), errorSelector);
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR returns SIT url when CMR_ENVIRONMENT=="SIT"', async (t) => {
  process.env.CMR_ENVIRONMENT = 'SIT';

  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const cmrFileKey = `${granuleId}.cmr.xml`;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFileKey,
        Body: fs.createReadStream('tests/data/meta.xml'),
      },
    });
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.sit.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
    delete process.env.CMR_ENVIRONMENT;
  }
});

test.serial('postToCMR throws an error if there is no CMR metadata file', async (t) => {
  const newPayload = cloneDeep(t.context.payload);

  newPayload.input.granules = [{
    granuleId: 'some granule',
    files: [{
      bucket: t.context.bucket,
      key: 'to/file.blah',
    }],
  }];

  try {
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    await postToCMR(newPayload);
  } catch (error) {
    t.true(error instanceof CMRMetaFileNotFound);
  }
});

test.serial('postToCMR throws an error if any granule is missing a metadata file', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const newGranule = {
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090555',
    files: [{
      bucket: t.context.bucket,
      key: 'to/file.blah',
    }],
  };
  newPayload.input.granules.push(newGranule);

  try {
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    await postToCMR(newPayload);
  } catch (error) {
    t.true(error instanceof CMRMetaFileNotFound);
    t.is(error.message, (`CMR Meta file not found for granule ${newGranule.granuleId}`));
  }
});

test.serial('postToCMR continues without metadata file if there is skipMetaCheck flag', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const newGranule = [{
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090555',
    files: [{
      bucket: t.context.bucket,
      key: 'to/file.blah',
    }],
  }];
  newPayload.input.granules = newGranule;
  newPayload.config.skipMetaCheck = true;
  const granuleId = newPayload.input.granules[0].granuleId;
  await validateInput(t, newPayload.input);
  await validateConfig(t, newPayload.config);
  const output = await postToCMR(newPayload);
  await validateOutput(t, output);
  t.is(output.granules[0].granuleId, granuleId);
});

test.serial('postToCMR continues with skipMetaCheck even if any granule is missing a metadata file', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const newGranule = {
    granuleId: 'MOD11A1.A2017200.h19v04.006.2017201090555',
    files: [{
      bucket: t.context.bucket,
      key: 'to/file.blah',
    }],
  };
  newPayload.input.granules.push(newGranule);
  newPayload.config.skipMetaCheck = true;

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: `${newPayload.input.granules[0].granuleId}.cmr.xml`,
        Body: fs.createReadStream('tests/data/meta.xml'),
      },
    });
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );
    t.is(output.granules[1].cmrLink, undefined);
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR identifies files with the new file schema', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const cmrFile = newPayload.input.granules[0].files[3];
  newPayload.input.granules[0].files = [{
    bucket: t.context.bucket,
    key: cmrFile.key,
  }];

  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: cmrFile.key,
        Body: fs.createReadStream('tests/data/meta.xml'),
      },
    });
    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);
    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
  }
});

test.serial('postToCMR succeeds with launchpad authentication', async (t) => {
  const newPayload = cloneDeep(t.context.payload);
  const granuleId = newPayload.input.granules[0].granuleId;
  const key = `${granuleId}.cmr.xml`;

  newPayload.config.cmr.oauthProvider = 'launchpad';
  sinon.stub(launchpad, 'getLaunchpadToken').callsFake(() => randomString());
  sinon.stub(cmrClient.CMR.prototype, 'ingestGranule').callsFake(resultThunk);

  try {
    await promiseS3Upload({
      params: {
        Bucket: t.context.bucket,
        Key: key,
        Body: fs.createReadStream(path.join(path.dirname(__filename), 'data', 'meta.xml')),
      },
    });

    await validateInput(t, newPayload.input);
    await validateConfig(t, newPayload.config);
    const output = await postToCMR(newPayload);
    await validateOutput(t, output);

    t.is(output.granules.length, 1);

    t.is(
      output.granules[0].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/concepts/${result['concept-id']}.echo10`
    );

    output.granules.forEach((g) => {
      t.true(Number.isInteger(g.post_to_cmr_duration));
      t.true(g.post_to_cmr_duration >= 0);
    });
  } finally {
    cmrClient.CMR.prototype.ingestGranule.restore();
    launchpad.getLaunchpadToken.restore();
  }
});

const test = require('ava');
const { s3 } = require('@cumulus/aws-client/services');
const { recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');
const { discoverPdrs } = require('..');

test.beforeEach(async (t) => {
  t.context.event = {
    config: {
      bucket: randomString(),
      collection: {
        name: randomString(),
        granuleIdExtraction: '^(.*)$',
        provider_path: randomString()
      },
      provider: {
        host: randomString(),
        id: randomString(),
        protocol: 's3'
      },
      stack: randomString()
    }
  };

  await Promise.all([
    s3().createBucket({ Bucket: t.context.event.config.bucket }).promise(),
    s3().createBucket({ Bucket: t.context.event.config.provider.host }).promise()
  ]);
});

test.afterEach.always((t) => Promise.all([
  recursivelyDeleteS3Bucket(t.context.event.config.bucket),
  recursivelyDeleteS3Bucket(t.context.event.config.provider.host)
]));

test.serial('test pdr discovery with S3 when there are no PDRs', async (t) => {
  t.context.event.config.collection = {
    granuleIdExtraction: '^(.*)$',
    name: randomString()
  };

  await validateConfig(t, t.context.event.config);

  const output = await discoverPdrs(t.context.event);

  await validateOutput(t, output);
  t.is(output.pdrs.length, 0);
});

test.serial('test pdr discovery with S3 when no PDRs are new', async (t) => {
  // Upload a PDR to the source
  const pdrName = `${randomString()}.PDR`;

  await s3().putObject({
    Bucket: t.context.event.config.bucket,
    Key: `${t.context.event.config.collection.provider_path}/${pdrName}`,
    Body: 'test PDR body'
  }).promise();

  // Upload a status indicator to show that this PDR has already been ingested

  // Although "folder" is a parameter for the constructor of the Discover class,
  // there is no way to set it in the DiscoverPdrs task.  The Discover class
  // defualts this value to 'pdrs'.  If that ever changes, this test is going
  // to break.
  const folder = 'pdrs';
  await s3().putObject({
    Bucket: t.context.event.config.bucket,
    Key: `${t.context.event.config.stack}/${folder}/${pdrName}`,
    Body: pdrName
  }).promise();

  await validateConfig(t, t.context.event.config);

  const output = await discoverPdrs(t.context.event);

  await validateOutput(t, output);
  t.is(output.pdrs.length, 0);
});

test.serial('test pdr discovery with S3 when some PDRs are new', async (t) => {
  // Upload PDRs to the source
  const oldPdrName = `${randomString()}-is-not-new.PDR`;
  const newPdrName = `${randomString()}-is-new.PDR`;

  await Promise.all([
    s3().putObject({
      Bucket: t.context.event.config.provider.host,
      Key: `${t.context.event.config.collection.provider_path}/${oldPdrName}`,
      Body: 'test PDR body'
    }).promise(),
    s3().putObject({
      Bucket: t.context.event.config.provider.host,
      Key: `${t.context.event.config.collection.provider_path}/${newPdrName}`,
      Body: 'test PDR body'
    }).promise()
  ]);

  // Upload a status indicator to show that this PDR has already been ingested

  // Although "folder" is a parameter for the constructor of the Discover class,
  // there is no way to set it in the DiscoverPdrs task.  The Discover class
  // defualts this value to 'pdrs'.  If that ever changes, this test is going
  // to break.
  const folder = 'pdrs';
  await s3().putObject({
    Bucket: t.context.event.config.bucket,
    Key: `${t.context.event.config.stack}/${folder}/${oldPdrName}`,
    Body: 'test PDR body'
  }).promise();

  await validateConfig(t, t.context.event.config);

  const output = await discoverPdrs(t.context.event);

  await validateOutput(t, output);
  t.is(output.pdrs.length, 1);
});

test.serial('test pdr discovery with S3 when all PDRs are new', async (t) => {
  // Upload a PDR to the source
  const pdrName = `${randomString()}.PDR`;

  await s3().putObject({
    Bucket: t.context.event.config.provider.host,
    Key: `${t.context.event.config.collection.provider_path}/${pdrName}`,
    Body: 'test PDR body'
  }).promise();

  await validateConfig(t, t.context.event.config);

  const output = await discoverPdrs(t.context.event);

  await validateOutput(t, output);
  t.is(output.pdrs.length, 1);
});

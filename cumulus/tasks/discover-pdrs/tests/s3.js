const test = require('ava');
const url = require('url');
const { recursivelyDeleteS3Bucket, s3, sqs } = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const { discoverPdrs } = require('../index');

async function createQueue() {
  const createQueueResponse = await sqs().createQueue({ QueueName: randomString() }).promise();

  // Properly set the Queue URL.  This is needed because LocalStack always
  // returns the QueueUrl as "localhost", even if that is not where it should
  // actually be found.  CircleCI breaks without this.
  const returnedQueueUrl = url.parse(createQueueResponse.QueueUrl);
  returnedQueueUrl.host = undefined;
  returnedQueueUrl.hostname = process.env.LOCALSTACK_HOST;

  return url.format(returnedQueueUrl);
}

async function uploadMessageTemplate(Bucket) {
  const templateKey = randomString();

  const messageTemplate = {
    cumulus_meta: {
      state_machine: randomString()
    },
    meta: {},
    payload: {},
    exception: null
  };

  await s3().putObject({
    Bucket,
    Key: templateKey,
    Body: JSON.stringify(messageTemplate)
  }).promise();

  return `s3://${Bucket}/${templateKey}`;
}

test.beforeEach(async (t) => {
  t.context.queueUrl = await createQueue();

  t.context.messageTemplateBucket = randomString();
  t.context.sourceBucket = randomString();
  t.context.statusBucket = randomString();

  await Promise.all([
    s3().createBucket({ Bucket: t.context.messageTemplateBucket }).promise(),
    s3().createBucket({ Bucket: t.context.sourceBucket }).promise(),
    s3().createBucket({ Bucket: t.context.statusBucket }).promise()
  ]);

  t.context.messageTemplateUrl = await uploadMessageTemplate(t.context.messageTemplateBucket);
});

test.afterEach.always((t) => Promise.all([
  sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise(),
  recursivelyDeleteS3Bucket(t.context.messageTemplateBucket),
  recursivelyDeleteS3Bucket(t.context.sourceBucket),
  recursivelyDeleteS3Bucket(t.context.statusBucket)
]));

test('test pdr discovery with S3 and a queue when there are no PDRs', async (t) => {
  const event = {
    config: {
      bucket: t.context.statusBucket,
      collection: {},
      provider: {
        host: t.context.sourceBucket,
        id: randomString(),
        protocol: 's3'
      },
      queueUrl: t.context.queueUrl,
      stack: randomString(),
      templateUri: t.context.messageTemplateUrl
    }
  };

  const output = await discoverPdrs(event);

  t.is(output.pdrs.length, 0);
});

test('test pdr discovery with S3 and witout queuing when there are no PDRs', async (t) => {
  const event = {
    config: {
      bucket: t.context.statusBucket,
      collection: {},
      provider: {
        host: t.context.sourceBucket,
        id: randomString(),
        protocol: 's3'
      },
      stack: randomString(),
      templateUri: t.context.messageTemplateUrl,
      useQueue: false
    }
  };

  const output = await discoverPdrs(event);

  t.is(output.pdrs.length, 0);
});

test('test pdr discovery with S3 when no PDRs are new', async (t) => {
  const providerPath = randomString();

  const event = {
    config: {
      bucket: t.context.statusBucket,
      collection: {
        provider_path: providerPath
      },
      provider: {
        host: t.context.sourceBucket,
        id: randomString(),
        protocol: 's3'
      },
      queueUrl: t.context.queueUrl,
      stack: randomString(),
      templateUri: t.context.messageTemplateUrl
    }
  };

  // Upload a PDR to the source
  const pdrName = `${randomString()}.PDR`;

  await s3().putObject({
    Bucket: t.context.sourceBucket,
    Key: `${providerPath}/${pdrName}`,
    Body: 'test PDR body'
  }).promise();

  // Upload a status indicator to show that this PDR has already been ingested

  // Although "folder" is a parameter for the constructor of the Discover class,
  // there is no way to set it in the DiscoverPdrs task.  The Discover class
  // defualts this value to 'pdrs'.  If that ever changes, this test is going
  // to break.
  const folder = 'pdrs';
  await s3().putObject({
    Bucket: t.context.statusBucket,
    Key: `${event.config.stack}/${folder}/${pdrName}`,
    Body: pdrName
  }).promise();

  const output = await discoverPdrs(event);

  t.is(output.pdrs.length, 0);
});

test('test pdr discovery with S3 when some PDRs are new', async (t) => {
  const providerPath = randomString();

  const event = {
    config: {
      bucket: t.context.statusBucket,
      collection: {
        provider_path: providerPath
      },
      provider: {
        host: t.context.sourceBucket,
        id: randomString(),
        protocol: 's3'
      },
      queueUrl: t.context.queueUrl,
      stack: randomString(),
      templateUri: t.context.messageTemplateUrl
    }
  };

  // Upload PDRs to the source
  const oldPdrName = `${randomString()}-is-not-new.PDR`;
  const newPdrName = `${randomString()}-is-new.PDR`;

  await Promise.all([
    s3().putObject({
      Bucket: t.context.sourceBucket,
      Key: `${providerPath}/${oldPdrName}`,
      Body: 'test PDR body'
    }).promise(),
    s3().putObject({
      Bucket: t.context.sourceBucket,
      Key: `${providerPath}/${newPdrName}`,
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
    Bucket: t.context.statusBucket,
    Key: `${event.config.stack}/${folder}/${oldPdrName}`,
    Body: 'test PDR body'
  }).promise();

  const output = await discoverPdrs(event);

  t.is(output.pdrs.length, 1);
});


test('test pdr discovery with S3 when all PDRs are new', async (t) => {
  const providerPath = randomString();

  const event = {
    config: {
      bucket: t.context.statusBucket,
      collection: {
        provider_path: providerPath
      },
      provider: {
        host: t.context.sourceBucket,
        id: randomString(),
        protocol: 's3'
      },
      queueUrl: t.context.queueUrl,
      stack: randomString(),
      templateUri: t.context.messageTemplateUrl
    }
  };

  // Upload a PDR to the source
  const pdrName = `${randomString()}.PDR`;

  await s3().putObject({
    Bucket: t.context.sourceBucket,
    Key: `${providerPath}/${pdrName}`,
    Body: 'test PDR body'
  }).promise();

  const output = await discoverPdrs(event);

  t.is(output.pdrs.length, 1);
});

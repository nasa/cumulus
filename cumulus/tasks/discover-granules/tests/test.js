'use strict';

const test = require('ava');
const mur = require('./fixtures/mur.json');
const { cloneDeep } = require('lodash');
const { recursivelyDeleteS3Bucket, s3, sqs } = require('@cumulus/common/aws');
const { createQueue, randomString } = require('@cumulus/common/test-utils');
const { discoverGranules } = require('../index');

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

test('test discovering mur granules', async (t) => {
  const event = cloneDeep(mur);
  event.config.useQueue = false;

  try {
    const output = await discoverGranules(event);
    t.is(output.granules.length, 3);
    t.is(output.granules[0].files.length, 2);
  }
  catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
});

test('test discovering mur granules over FTP with queue', async (t) => {
  const internalBucket = randomString();
  const messageTemplateBucket = randomString();
  await Promise.all([
    s3().createBucket({ Bucket: messageTemplateBucket }).promise(),
    s3().createBucket({ Bucket: internalBucket }).promise()
  ]);

  const event = cloneDeep(mur);
  event.config.buckets.internal = internalBucket;
  event.config.collection.provider_path = '/allData/ghrsst/data/GDS2/L4/GLOB/JPL/MUR/v4.1/2017/(20[1-3])'; // eslint-disable-line max-len
  event.config.queueUrl = await createQueue();
  event.config.templateUri = await uploadMessageTemplate(messageTemplateBucket);
  event.config.useQueue = true;

  try {
    const output = await discoverGranules(event);
    t.is(output.granules.length, 3);
  }
  catch (e) {
    if (e.message.includes('getaddrinfo ENOTFOUND')) {
      t.pass('Ignoring this test. Test server seems to be down');
    }
    else t.fail(e);
  }
  finally {
    await Promise.all([
      sqs().deleteQueue({ QueueUrl: event.config.queueUrl }).promise(),
      recursivelyDeleteS3Bucket(internalBucket),
      recursivelyDeleteS3Bucket(messageTemplateBucket)
    ]);
  }
});

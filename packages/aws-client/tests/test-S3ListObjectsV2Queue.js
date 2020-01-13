'use strict';

const test = require('ava');
const range = require('lodash.range');
const { randomString } = require('@cumulus/common/test-utils');

const awsServices = require('../services');
const { recursivelyDeleteS3Bucket } = require('../S3');
const S3ListObjectsV2Queue = require('../S3ListObjectsV2Queue');

test.beforeEach((t) => {
  t.context.bucketName = randomString();
  return awsServices.s3().createBucket({ Bucket: t.context.bucketName }).promise();
});

test.afterEach.always((t) => recursivelyDeleteS3Bucket(t.context.bucketName));

test.serial('S3ListObjectsV2Queue.peek() returns the next object but does not remove it from the queue', async (t) => {
  const key = randomString();
  await awsServices.s3().putObject({ Bucket: t.context.bucketName, Key: key, Body: 'body' }).promise();

  const queue = new S3ListObjectsV2Queue({ Bucket: t.context.bucketName });

  t.is((await queue.peek()).Key, key);
  t.is((await queue.peek()).Key, key);
});

test.serial('S3ListObjectsV2Queue.shift() returns the next object and removes it from the queue', async (t) => {
  const key = randomString();
  await awsServices.s3().putObject({ Bucket: t.context.bucketName, Key: key, Body: 'body' }).promise();

  const queue = new S3ListObjectsV2Queue({ Bucket: t.context.bucketName });

  t.is((await queue.peek()).Key, key);
  t.is((await queue.shift()).Key, key);
  t.is(await queue.peek(), null);
});

test.serial('S3ListObjectsV2Queue can handle paging', async (t) => {
  await Promise.all(range(11).map(() =>
    awsServices.s3().putObject({
      Bucket: t.context.bucketName,
      Key: randomString(),
      Body: 'body'
    }).promise()));

  const queue = new S3ListObjectsV2Queue({
    Bucket: t.context.bucketName,
    MaxKeys: 2 // Force paging of results
  });

  let returnedObjectsCount = 0;
  let nextObect = await queue.shift();
  while (nextObect) {
    returnedObjectsCount += 1;
    nextObect = await queue.shift(); // eslint-disable-line no-await-in-loop
  }

  t.is(returnedObjectsCount, 11);
});

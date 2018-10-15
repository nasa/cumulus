'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');
const { s3, fileExists, recursivelyDeleteS3Bucket, deleteS3Object } = require('@cumulus/common/aws');
const { crypto } = require('../lib/crypto');

const bucket = randomString();
const stack = randomString();
const prefix = `${stack}/crypto`;
const s3Client = s3();

async function keyModifiedDates () {
    const vals = await Promise.all([
        s3Client.headObject({ Bucket: bucket, Key: `${prefix}/public.pub` }).promise(),
        s3Client.headObject({ Bucket: bucket, Key: `${prefix}/private.pem` }).promise()
    ]);
    return vals.map((v) => v.LastModified);
}

test.before(async (t) => {
    await s3Client.createBucket({ Bucket: bucket }).promise();
});

test.after(async (t) => {
    await recursivelyDeleteS3Bucket(bucket);
});

test.serial('crypto creates keys when they do not exist', async (t) => {
    t.false(await fileExists(bucket, `${prefix}/public.pub`));
    t.false(await fileExists(bucket, `${prefix}/private.pem`));
    await crypto(stack, bucket, s3Client);
    t.truthy(await fileExists(bucket, `${prefix}/public.pub`));
    t.truthy(await fileExists(bucket, `${prefix}/private.pem`));
});

test.serial('crypto creates new key pair when either file does not exist', async (t) => {
    const lastUpdatedTimes = await keyModifiedDates();
    await deleteS3Object(bucket, `${prefix}/public.pub`);
    await crypto(stack, bucket, s3Client);
    const newTimes = await keyModifiedDates();
    t.notDeepEqual(lastUpdatedTimes, newTimes);
    await deleteS3Object(bucket, `${prefix}/private.pem`);
    await crypto(stack, bucket, s3Client);
    t.notDeepEqual(newTimes, await keyModifiedDates());
});

test.serial('crypto does not create new keys when they do exist', async (t) => {
    const lastUpdatedTimes = await keyModifiedDates();
    await crypto(stack, bucket, s3Client);
    t.deepEqual(lastUpdatedTimes, await keyModifiedDates());
});
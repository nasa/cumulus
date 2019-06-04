'use strict';

const test = require('ava');
const {
  getMessageFromTemplate
} = require('../message');

test('getMessageTemplate throws error if invalid S3 URI is provided', async (t) => {
  await t.throws(getMessageFromTemplate('fake-uri'));
});

test('getMessageTemplate throws error if non-existent S3 URI is provided', async (t) => {
  await t.throws(getMessageFromTemplate('s3://some-bucket/some-key'));
});

test.todo('getMessageTemplate throws error if message template body is not JSON');

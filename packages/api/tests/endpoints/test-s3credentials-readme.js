'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;

const endpoint = rewire('../../endpoints/s3credentials-readme/index.js');
const displayS3CredentialInstructions = endpoint.__get__('displayS3CredentialInstructions');

test('displayS3Credentials fills template with correct distribution endpoint.', async (t) => {
  const send = sinon.spy();
  const res = { send };
  const expectedLink = `<a href="${process.env.DISTRIBUTION_ENDPOINT}s3credentials" target="_blank">${process.env.DISTRIBUTION_ENDPOINT}s3credentials</a>`;

  await displayS3CredentialInstructions(undefined, res);
  t.true(send.calledWithMatch(expectedLink));
});

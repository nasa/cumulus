'use strict';

const fs = require('fs');
const test = require('ava');
const rewire = require('rewire');
const request = require('supertest');

const launchpad = require('@cumulus/common/launchpad');
const aws = require('@cumulus/common/aws');
const { randomId } = require('@cumulus/common/test-utils');

const launchpadSaml = rewire('../../app/launchpadSaml');

const buildLaunchpadJwt = launchpadSaml.__get__('buildLaunchpadJwt');
const launchpadPublicCertificate = launchpadSaml.__get__(
  'launchpadPublicCertificate'
);

const xmlMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/launchpad-sbx-metadata.xml`,
  'utf8'
);
const badMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/bad-metadata.xml`,
  'utf8'
);
const goodMetadataFile = {
  key: 'valid-metadata.xml',
  content: xmlMetadataFixture
};
const badMetadataFile = {
  key: 'bad-metadata.xml',
  content: badMetadataFixture
};
const testFiles = [goodMetadataFile, badMetadataFile];

const certificate = require('./fixtures/certificateFixture');
const testBucketName = randomId('testbucket');

test.before(async (t) => {
  await aws.s3().createBucket({ Bucket: testBucketName }).promise();
  await Promise.all(
    testFiles.map((f) => aws.s3PutObject({
      Bucket: testBucketName,
      Key: f.key,
      Body: f.content
    }))
  );
});

test.after.always(async (t) => {
  await aws.recursivelyDeleteS3Bucket(testBucketName);
});

test.serial(
  'launchpadPublicCertificate returns a certificate from valid file.',
  async (t) => {
    const parsedCertificate = await launchpadPublicCertificate(
      `s3://${testBucketName}/valid-metadata.xml`
    );

    t.deepEqual(parsedCertificate, certificate);
  }
);

test.serial(
  'launchpadPublicCertificate throws error with invalid file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/bad-metadata.xml`),
      {
        instanceOf: Error,
        message: `Failed to retrieve Launchpad metadata X509 Certificate from s3://${testBucketName}/bad-metadata.xml`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing metadata file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/location`),
      {
        instanceOf: Error,
        message: `Cumulus could not find Launchpad public xml metadata at s3://${testBucketName}/location`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing bucket.',
  async (t) => {
    await t.throwsAsync(launchpadPublicCertificate('s3://badBucket/location'), {
      instanceOf: Error,
      message:
        'Cumulus could not find Launchpad public xml metadata at s3://badBucket/location'
    });
  }
);

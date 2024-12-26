'use strict';

const test = require('ava');
const path = require('path');
const urljoin = require('url-join');
const { randomId, validateInput, validateConfig, validateOutput } = require('@cumulus/common/test-utils');
const S3 = require('@cumulus/aws-client/S3');
const { sendPAN } = require('../dist/src');

// eslint-disable-next-line max-len
const regex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "SUCCESSFUL";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;
// eslint-disable-next-line max-len
const failedRegex = /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "FAILED";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/;

test.before(async (t) => {
  t.context.providerBucket = randomId('bucket');

  await Promise.all([
    S3.createBucket(t.context.providerBucket),
  ]);
});

test.after.always(async (t) => await Promise.all([
  S3.recursivelyDeleteS3Bucket(t.context.providerBucket),
]));

test('SendPan task calls upload', async (t) => {
  const fileNameBase = 'test-uploadcall-pdr';
  const port = 3030;
  const event = {
    config: {
      provider: {
        id: randomId('provideId'),
        globalConnectionLimit: 5,
        host: 'localhost',
        port,
        protocol: 'http',
        createdAt: 1676325180635,
        updatedAt: 1677776213600,
      },
      remoteDir: 'post_test',
    },
    input: {
      pdr: {
        name: `${fileNameBase}.pdr`,
        path: 'some-pdr-path',
      },
      running: [],
      completed: [],
      failed: [],
    },
  };

  const url = `http://${event.config.provider.host}:${port}`;
  const remotePath = path.join(event.config.remoteDir, `${fileNameBase}.PAN`);
  // Message should look like this:
  // MESSAGE_TYPE = "SHORTPAN";
  // DISPOSITION = "SUCCESSFUL";
  // TIME_STAMP = 2023-03-27T18:10:56.402Z;

  await validateInput(t, event.input);
  await validateConfig(t, event.config);
  const output = await sendPAN(event);
  await validateOutput(t, output);

  t.is(output.pan.uri, urljoin(url, remotePath));
});

test('SendPan task sends PAN to HTTP server', async (t) => {
  const event = {
    config: {
      provider: {
        id: randomId('httpProvider'),
        globalConnectionLimit: 5,
        protocol: 'http',
        host: '127.0.0.1',
        port: 3030,
      },
      remoteDir: 'pan/remote-dir/',
    },
    input: {
      pdr: {
        name: 'test-send-http-pdr.pdr',
        path: 'some-pdr-path',
      },
      running: [],
      completed: [],
      failed: [],
    },
  };

  try {
    await sendPAN(event);
    t.fail();
  } catch (error) {
    // uploading file to httpd running in docker returns error
    if (error.message.includes('Response code 404 (Not Found)')) {
      t.pass();
    }
  }
});

test('SendPan task sends PAN to s3', async (t) => {
  const remoteDir = 'pan/remote-dir';
  const fileNameBase = 'test-send-s3-pdr';
  const uploadPath = path.join(remoteDir, `${fileNameBase}.PAN`);
  const event = {
    config: {
      provider: {
        id: randomId('s3Provider'),
        globalConnectionLimit: 5,
        protocol: 's3',
        host: t.context.providerBucket,
      },
      remoteDir,
    },
    input: {
      pdr: {
        name: `${fileNameBase}.pdr`,
        path: 'some-pdr-path',
      },
      running: [],
      completed: [],
      failed: [],
    },
  };

  try {
    await validateInput(t, event.input);
    await validateConfig(t, event.config);
    const output = await sendPAN(event);
    await validateOutput(t, output);
    const text = await S3.getTextObject(t.context.providerBucket, uploadPath);
    t.regex(text, regex);
    t.is(output.pan.uri, S3.buildS3Uri(t.context.providerBucket, uploadPath));
  } catch (error) {
    console.log(error);
    t.fail();
  }
});

test('SendPan task throws error when provider protocol is not supported', async (t) => {
  const event = {
    config: {
      provider: {
        id: randomId('ftpProvider'),
        globalConnectionLimit: 5,
        protocol: 'ftp',
        host: randomId('s3bucket'),
      },
      remoteDir: 'pan/remote-dir/',
    },
    input: {
      pdr: {
        name: 'test-send-ftp-pdr.pdr',
        path: 'some-pdr-path',
      },
      running: [],
      completed: [],
      failed: [],
    },
  };

  try {
    await validateInput(t, event.input);
    await validateConfig(t, event.config);
    await sendPAN(event);
    t.fail();
  } catch (error) {
    if (error.message.includes('Protocol ftp is not supported')) {
      t.pass();
    }
  }
});

test('SendPan task sends PAN to default location when remoteDir is null', async (t) => {
  const fileNameBase = 'test-default-pan-path-pdr';
  const uploadPath = `pans/${fileNameBase}.PAN`;
  const event = {
    config: {
      provider: {
        id: randomId('s3Provider'),
        globalConnectionLimit: 5,
        protocol: 's3',
        host: t.context.providerBucket,
      },
      remoteDir: null,
    },
    input: {
      pdr: {
        name: `${fileNameBase}.pdr`,
        path: 'some-pdr-path',
      },
      running: [],
      completed: [],
      failed: [],
    },
  };

  try {
    await validateInput(t, event.input);
    await validateConfig(t, event.config);
    const output = await sendPAN(event);
    t.log(output);
    await validateOutput(t, output);
    const text = await S3.getTextObject(t.context.providerBucket, uploadPath);
    t.regex(text, regex);
    t.is(output.pan.uri, S3.buildS3Uri(t.context.providerBucket, uploadPath));
  } catch (error) {
    console.log(error);
    t.fail();
  }
});

test('SendPan task fails with executions still running', async (t) => {
  const event = {
    config: {
      provider: {
        id: randomId('s3Provider'),
        globalConnectionLimit: 5,
        protocol: 's3',
        host: t.context.providerBucket,
      },
      remoteDir: null,
    },
    input: {
      pdr: {
        name: 'test.pdr',
        path: 'some-pdr-path',
      },
      running: ['arn:running:execution'],
      completed: [],
      failed: [],
    },
  };

  try {
    await validateInput(t, event.input);
    await validateConfig(t, event.config);
    await sendPAN(event);
    t.fail();
  } catch (error) {
    if (error.message.includes('Executions still running')) {
      t.pass();
    }
  }
});

test('SendPan task sends failed PAN to s3', async (t) => {
  const fileNameBase = 'test-failed-pan-path-pdr';
  const uploadPath = `pans/${fileNameBase}.PAN`;
  const event = {
    config: {
      provider: {
        id: randomId('s3Provider'),
        globalConnectionLimit: 5,
        protocol: 's3',
        host: t.context.providerBucket,
      },
      remoteDir: null,
    },
    input: {
      pdr: {
        name: `${fileNameBase}.pdr`,
        path: 'some-pdr-path',
      },
      running: [],
      completed: ['arn:completed:execution', 'arn:completed:execution', 'arn:completed:execution'],
      failed: [{ arn: 'arn:failed:execution', reason: 'Workflow Failed' }],
    },
  };

  try {
    await validateInput(t, event.input);
    await validateConfig(t, event.config);
    const output = await sendPAN(event);
    t.log(output);
    await validateOutput(t, output);
    const text = await S3.getTextObject(t.context.providerBucket, uploadPath);
    t.regex(text, failedRegex);
    t.is(output.pan.uri, S3.buildS3Uri(t.context.providerBucket, uploadPath));
  } catch (error) {
    console.log(error);
    t.fail();
  }
});

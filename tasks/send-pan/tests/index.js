'use strict';

const test = require('ava');
const nock = require('nock');
const { randomId } = require('@cumulus/common/test-utils');
const { sendPAN } = require('..');

test('SendPan task calls upload', async (t) => {
  const event = {
    config: {
      provider: {
        id: randomId('provideId'),
        globalConnectionLimit: 5,
        host: 'some-host.org',
        protocol: 'http',
        createdAt: 1676325180635,
        updatedAt: 1677776213600,
      },
      pdrName: 'some-pdr.pdr',
      remoteDir: '/some-remote-dir/',
    },
  };

  const url = `http://${event.config.provider.host}`;
  const remotePath = `${event.config.remoteDir}${event.config.pdrName.replace('.pdr', '.pan')}`;
  // Message should look like this:
  // MESSAGE_TYPE = "SHORTPAN";
  // DISPOSITION = "SUCCESSFUL";
  // TIME_STAMP = 2023-03-27T18:10:56.402Z;
  nock(url).post(remotePath,
    // eslint-disable-next-line max-len
    /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "SUCCESSFUL";\nTIME_STAMP = \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z;\n/)
    .reply(200);

  await sendPAN(event);
  t.true(nock.isDone());
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
      pdrName: 'test-send-http-pdr.pdr',
      remoteDir: '/pdrs/discover-pdrs',
    },
  };

  try {
    await sendPAN(event);
    t.fail();
  } catch (e) {
    // uploading file to httpd running in docker returns error
    if (e.message.includes('Response code 404 (Not Found)')) {
      t.pass();
    }
  }
});

test('SendPan task does not support protocols besides http/https', async (t) => {
  const event = {
    config: {
      provider: {
        id: randomId('s3Provider'),
        globalConnectionLimit: 5,
        protocol: 's3',
        host: randomId('s3bucket'),
      },
      pdrName: 'test-send-s3-pdr.pdr',
      remoteDir: '/pdrs/discover-pdrs',
    },
  };

  try {
    await sendPAN(event);
    t.fail();
  } catch (e) {
    if (e.message.includes('Protocol s3 is not supported')) {
      t.pass();
    }
  }
});

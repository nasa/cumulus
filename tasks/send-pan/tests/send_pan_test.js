'use strict';

const test = require('ava');
const nock = require('nock');
const SendPan = require('..');

test('Test upload called from Send Pan Task', async (t) => {
  const event = {
    config: {
      provider: {
        id: 'some-id',
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
    /MESSAGE_TYPE = "SHORTPAN";\nDISPOSITION = "SUCCESSFUL";\nTIME_STAMP = [\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}.[\d]{3}Z;\n/
    ).reply(200);

  await SendPan.sendPAN(event);
  t.true(nock.isDone());
});

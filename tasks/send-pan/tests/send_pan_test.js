'use strict';

const test = require('ava');
const SendPan = require('..');
const nock = require('nock');

test('Test upload called from Send Pan Task', async (t) => {
  const event = {
    'config': {
      'provider': {
        "id": "some-id",
        "globalConnectionLimit": 5,
        "host": "some-host.org",
        "protocol": "http",
        "createdAt": 1676325180635,
        "updatedAt": 1677776213600
      },
      'pdrName': 'some-pdr.pdr',
      'remoteDir': '/some-remote-dir/'
    }
  };

  const url = `http://${event['config']['provider']['host']}`
  const remote_path = `${event['config']['remoteDir']}${event['config']['pdrName'].replace('.pdr', '.pan')}`
  var intercept = nock(url).post(remote_path)
    .reply(200);

  await SendPan.sendPAN(event)
  t.true(nock.isDone());
});


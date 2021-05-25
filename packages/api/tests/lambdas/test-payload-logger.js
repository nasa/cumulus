'use strict';

const cloneDeep = require('lodash/cloneDeep');
const log = require('@cumulus/common/log');
const sinon = require('sinon');
const test = require('ava');
const payloadLogger = require('../../lambdas/payload-logger');

const event = {
  Records: [{
    kinesis: {
      kinesisSchemaVersion: '1.0',
      partitionKey: 'notapartitionkey',
      sequenceNumber: 12345,
      data: 'c29tZV9kYXRhX2hlcmU=',
      eventSource: 'aws:',
      eventVersion: '1.0',
      eventID: 'someshardid',
      eventName: 'aws:kinesis:record',
      invokeIdentityArn: 'someArnHere',
      awsRegion: 'us-east-1',
      eventSourceARN: 'someEventSourceArnHere',
    },
  }],
};

test('The lambda processes incoming record and writes to CloudWatch', (t) => {
  const expected = cloneDeep(event);
  expected.Records[0].kinesis.data = 'some_data_here';

  const logMock = sinon.mock(log).expects('info').withArgs(JSON.stringify(expected.Records[0])).once();
  log.info = logMock;

  const actual = payloadLogger.kinesisEventLogger(event, log);

  t.deepEqual(expected, actual);
});

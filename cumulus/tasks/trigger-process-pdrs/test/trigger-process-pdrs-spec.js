'use strict';
const test = require('ava');
const helpers = require('@cumulus/common/test-helpers');
const TriggerProcessPdrs = require('../index');

test('trigger process PDRs', async t => {
  const payload = [
    { s3_key: '123' },
    { s3_key: 'ABC' }
  ];
  let message = helpers.collectionMessageInput('VNGCR_LQD_C1_SIPS', 'TriggerProcessPdrs');
  message = Object.assign(message, { payload: payload });
  const ingestMeta = Object.assign({}, message.ingest_meta, { message_source: 'stdin' });
  message.ingest_meta = ingestMeta;
  const [errors, data] = await helpers.run(TriggerProcessPdrs, message);
  t.is(errors, null, 'Expected no errors');
  t.is(data.length, 2, 'Expected two executions');
  t.is(data[0].stateMachineArn, 'ProcessPdrSIPSTEST');
  t.is(data[0].name, '123__id-1234');
  t.is(data[1].stateMachineArn, 'ProcessPdrSIPSTEST');
  t.is(data[1].name, 'ABC__id-1234');
});

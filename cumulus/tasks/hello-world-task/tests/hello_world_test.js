'use strict';
const test = require('ava');
const helpers = require('@cumulus/common/test-helpers');
const HelloWorld = require('../index');


test('Test return value from Hello World Task', async t => {

  /*
  * This setup prepares a formatted message required For the Task class.
  * The specific values of the message don't make a difference
  * as the Hello World Task doesn't use any parameters.
  */
  const payload = [{ s3_key: '123' }];
  let message = helpers.collectionMessageInput('VNGCR_LQD_C1_SIPS', 'HelloWorld');
  message = Object.assign(message, { payload: payload });
  const ingestMeta = Object.assign({}, message.ingest_meta, { message_source: 'stdin' });
  message.ingest_meta = ingestMeta;

  const [errors, data] = await helpers.run(HelloWorld, message);

  t.is(errors, null);
  t.is(data.hello, "Hello World");
});

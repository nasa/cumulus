'use strict';
const expect = require('expect.js');
const helpers = require('@cumulus/common/test-helpers');
const TriggerIngestTask = require('../index');

xdescribe('trigger-ingest.handler', () => {
  let result;
  beforeEach(async (done) => {
    try {
      result = null;
      const message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'TriggerIngest');
      result = await helpers.run(TriggerIngestTask, message);
    }
    finally {
      done();
    }
  });

  it('TODO', () => {
  });
});

'use strict';
const expect = require('expect.js');
const helpers = require('@cumulus/common/test-helpers');
const SyncWmsTask = require('../index');

xdescribe('sync-wms.handler', () => {
  let result;
  beforeEach(async (done) => {
    try {
      result = null;
      const message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'MyTask');
      result = await helpers.run(SyncWmsTask, message);
    }
    finally {
      done();
    }
  });

  it('TODO', () => {
  });
});

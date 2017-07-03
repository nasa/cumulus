'use strict';
const expect = require('expect.js');
const helpers = require('cumulus-common/test-helpers');
const DiscoverCmrGranulesTask = require('../index');

xdescribe('discover-cmr-granules.handler', () => {
  let result;
  beforeEach(async (done) => {
    try {
      result = null;
      const message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'DiscoverCmrGranules');
      result = await helpers.run(DiscoverCmrGranulesTask, message);
    }
    finally {
      done();
    }
  });

  it('TODO', () => {
  });
});

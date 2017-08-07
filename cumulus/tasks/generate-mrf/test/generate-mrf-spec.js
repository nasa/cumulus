'use strict';
const expect = require('expect.js');
const helpers = require('@cumulus/common/test-helpers');
const GenerateMrfTask = require('../index');

xdescribe('generate-mrf.handler', () => {
  let result;
  beforeEach(async (done) => {
    try {
      result = null;
      const message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'GenerateMrf');
      result = await helpers.run(GenerateMrfTask, message);
    }
    finally {
      done();
    }
  });

  it('TODO', () => {
  });
});

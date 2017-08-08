'use strict';
const expect = require('expect.js');
const helpers = require('cumulus-common/test-helpers');
const DiscoverHttpTilesTask = require('../index');

describe('discover-http-tiles.handler', () => {
  describe('for a VIIRS product', () => {
    const message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'DiscoverHttpTiles');
    const config = message.workflow_config_template.DiscoverHttpTiles;
    config.root += 'VNGCR_LQD_C1_r01c01/';

    // Note: This crawls a subset of a real site to avoid the general mess of mocks. It's set up
    //       to only do so once per execution
    describe('crawling a site', () => {
      let result;
      before((done) => {
        helpers
          .run(DiscoverHttpTilesTask, message)
          .then((response) => {
            [, result] = response;
          })
          .then(done)
          .catch(done);
      });

      it('groups the product\'s URLs by Julian date', () => {
        for (const grouping of result) {
          expect(grouping.meta.key).to.match(/VIIRS\/VNGCR_LQD_C1\/\d{7}/);
        }
      });

      it('provides an identifier to determine if URLs have changed', () => {
        for (const grouping of result) {
          for (const resource of grouping.payload) {
            // Match the version string, which is the server date + "s" + file size
            expect(resource.version).to.match(/\d+\w{3}\d+s\d+/);
          }
        }
      });

      it('only provides URLs where .jgw, .jpg, and .txt files are all present', () => {
        for (const grouping of result) {
          const extensions = [];
          for (const resource of grouping.payload) {
            extensions.push(resource.url.split('.').pop());
          }
          expect(extensions.indexOf('jgw')).to.not.be(-1);
          expect(extensions.indexOf('jpg')).to.not.be(-1);
          expect(extensions.indexOf('txt')).to.not.be(-1);
        }
      });

      it('returns a message for each product grouping', () => {
        for (const grouping of result) {
          expect(grouping.meta.key).to.match(/VIIRS\/VNGCR_LQD_C1\/\d{7}/);
        }
      });
    });
  });
});

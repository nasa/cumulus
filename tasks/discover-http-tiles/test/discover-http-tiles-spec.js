'use strict';
const expect = require('expect.js');
const aws = require('gitc-common/aws');

const promiseWithData = (data)=> {
  return new Promise(
    (resolve,reject) => resolve(data)
  );
};


// Mimics the AWS dynamo db client enough so that the semaphore will allow execution.
// This permits the test to run without having to actually use dynamo db for locking.
class FakeDynamoClient{
  put(params){
    return {promise: ()=> promiseWithData(null) };
  }
  update(params){
    return {promise: ()=> promiseWithData(null)};
  }
}

const DiscoverHttpTilesTask = require('../index');

const helpers = require('gitc-common/test-helpers');

describe('discover-http-tiles.handler', () => {
  describe('for a VIIRS product', () => {
    const event = helpers.collectionEventInput('VNGCR_LQD_C1');
    event.config = event.collection.ingest.config;
    event.config.root += 'VNGCR_LQD_C1_r02c00/';

    // Note: This crawls a subset of a real site to avoid the general mess of mocks. It's set up
    //       to only do so once per execution
    describe('crawling a site', () => {
      let triggeredEvents;
      let originalDynamoClient = aws.dynamodbDocClient;

      before((done) => {
        aws.dynamodbDocClient = ()=> new FakeDynamoClient();

        helpers
          .run(DiscoverHttpTilesTask, event)
          .then((events) => {
            triggeredEvents = events;
          })
          .then(done)
          .catch(done);
      });

      after((done)=> {
        aws.dynamodbDocClient = originalDynamoClient;
        done();
      });

      it('groups the product\'s URLs by Julian date', () => {
        for (const [, id] of triggeredEvents) {
          expect(id).to.match(/VIIRS\/VNGCR_LQD_C1\/\d{7}/);
        }
      });

      it('provides an identifier to determine if URLs have changed', () => {
        for (const [, , eventData] of triggeredEvents) {
          for (const resource of eventData.payload) {
            // Match the version string, which is the server date + "s" + file size
            expect(resource.version).to.match(/\d+\w{3}\d+s\d+/);
          }
        }
      });

      it('only provides URLs where .jgw, .jpg, and .txt files are all present', () => {
        for (const [, , eventData] of triggeredEvents) {
          const extensions = [];
          for (const resource of eventData.payload) {
            extensions.push(resource.url.split('.').pop());
          }
          expect(extensions.indexOf('jgw')).to.not.be(-1);
          expect(extensions.indexOf('jpg')).to.not.be(-1);
          expect(extensions.indexOf('txt')).to.not.be(-1);
        }
      });

      it('triggers an event for each product grouping', () => {
        for (const [, id] of triggeredEvents) {
          expect(id).to.match(/VIIRS\/VNGCR_LQD_C1\/\d{7}/);
        }
      });
    });
  });
});

"use strict";

const sinon = require('sinon');
const expect = require('expect.js');

//const indexer = require('../tasks/discover/http-tile-indexer');

describe('http-sync.handler', function() {
  it('pending', function(){});
});

xdescribe('http-tile-indexer.handler', function() {
  const BUCKET_NAME = 'dummy-bucket';

  describe('for a VIIRS product', function() {
    let event = {
      type: 'VIIRS',
      product: 'VNGCR_LQD_C1',
      url: 'http://lance3.modaps.eosdis.nasa.gov/imagery/elements/VIIRS/VNGCR_LQD_C1/VNGCR_LQD_C1_r02c00/',
      publish: BUCKET_NAME
    }

    // Note: This crawls a subset of a real site to avoid the general mess of mocks. It's set up
    //       to only do so once per execution
    describe('crawling a site', function() {
      //sinon.stub(indexer.log, 'info');
      //sinon.stub(indexer.s3, 'upload').yields(null, null);
      let crawlResult;

      before(function(done) {
        indexer.handler(event, null, function(err, result, extra) {
          if (err) raise(err);
          crawlResult = extra;
          done();
        });
      });

      after(function() {
        indexer.log.info.restore();
        indexer.s3.upload.restore();
      });

      it('groups the product\'s URLs by Julian date', function() {
        for (let resource of crawlResult.resources) {
          expect(resource.parent).to.match(/20\d{3,5}/);
          for (let file of resource.files) {
            expect(file.url.indexOf("/" + resource.parent + "/")).to.not.be(-1);
          }
        }
      });

      it('provides an identifier to determine if URLs have changed', function() {
        for (let resource of crawlResult.resources) {
          for (let file of resource.files) {
            // Match the version string, which is the server date + "s" + file size
            expect(file.version).to.match(/\d+\w{3}\d+s\d+/);
          }
        }
      });

      it('only provides URLs where .jgw, .jpg, and .txt files are all present', function() {
        for (let resource of crawlResult.resources) {
          let extensions = [];
          for (let file of resource.files) {
            extensions.push(file.url.split('.').pop());
          }
          expect(extensions.indexOf('jgw')).to.not.be(-1);
          expect(extensions.indexOf('jpg')).to.not.be(-1);
          expect(extensions.indexOf('txt')).to.not.be(-1);
        }
      });

      it('uploads an index file to s3 for each product grouping', function() {
        for (let resource of crawlResult.resources) {
          sinon.assert.calledWith(
            indexer.s3.upload,
            {
              Bucket: BUCKET_NAME,
              Key: "http-sources/VNGCR_LQD_C1/" + resource.parent,
              Body: JSON.stringify(resource)
            },
            sinon.match.any
          );
        }
      });
    });
  });
});

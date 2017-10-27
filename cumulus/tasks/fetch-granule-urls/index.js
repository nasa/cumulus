'use strict';

const Task = require('@cumulus/common/task');
const https = require('https');
const AWS = require('aws-sdk');
const request = require('request');
const s3 = new AWS.S3();


/**
 * Task which discovers granules by querying the CMR
 * Input payload: none
 * Output payload: Array of objects { meta: {...} } containing meta as specified in the task config
 *                 for each discovered granule
 */
module.exports = class FetchGranuleURLsTask extends Task {
  /**
   * Main task entrypoint
   * @return An array of CMR granules that need ingest
   */

   //**TODO** this.config, this.message(.payload)
   //**TODO**eslint in sublime
  async run() {
    this.getCMRdata('2015-01-01', '2015-01-02');
  }

  getCMRdata(startDate, endDate) {
    const url = `https://cmr.earthdata.nasa.gov/search/granules.json?echo_collection_id=C1000000320-LPDAAC_ECS&pretty=true&page_num=1&page_size=10&temporal=${startDate}T00%3A00%3A00Z,${endDate}T00%3A00%3A00Z`;
    https.get(url, res => {
      console.log('statusCode:', res.statusCode);
      console.log('headers:', res.headers);
      res.setEncoding('utf8');
        let body = '';
        res.on('data', data => {
        body += data;
      });
      res.on('end', () => {
        body = JSON.parse(body);
        // console.log(JSON.stringify(body, null, 4));
        this.extractTifURLS(body);
      });
    });
  }

  extractTifURLS(responseObject) {
    const tifURLS = [];
    responseObject.feed.entry.forEach(function (granule) {
        granule.links.forEach(function (link) {
          if (link.href.endsWith('.tif')) {
            tifURLS.push(link.href);
          }
      });
    });
    console.log(tifURLS);
    const that = this;
    tifURLS.forEach(function (url) {
      const key = url.substring(url.lastIndexOf("/")+1,url.lastIndexOf("."));
      that.urlToS3(url, 'ast-l1t-2015-granules', key, function(err, res) {
          if (err) throw err;
        console.log('Uploaded data successfully!');
      });
    });
    // const tifURLStest = ['https://i.imgur.com/08u6ePd.jpg'];
    // console.log(tifURLStest);
    // const that = this;
    // tifURLStest.forEach(function (url) {
    //   const key = url.substring(url.lastIndexOf('/') + 1, url.lastIndexOf('.'));
    //   console.log(key);
    //   that.urlToS3(url, 'ast-l1t-2015-granules', key, function(err) {
    //       if (err) throw err;
    //     console.log('Uploaded data successfully!');
    //   });
    // });
  }

  urlToS3(url, bucket, key, callback) {
    request({
        url: url,
        auth: {
          'user': 'sample_user',
          'pass': 'SampleUser1234',
          // 'sendImmediately': false
        },
        followRedirect: true,
        encoding: null
      }, function(err, res, body) {
        if (err) {
          console.log('ERROR in urlToS3');
          console.log(err);
          return callback(err, res);
        }
        console.log(body, res);
        // console.log(body, res.statusCode, res.headers);
        console.log('-------------------------------------------------');

        s3.putObject({
            Bucket: bucket,
            Key: key,
            ContentType: res.headers['content-type'],
            ContentLength: res.headers['content-length'],
            Body: body
        }, callback);
      });
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return FetchGranuleURLsTask.handle(...args);
  }
};

// To run a small test:
// node fetch-granule-urls local

const local = require('@cumulus/common/local-helpers');
const localTaskName = 'FetchGranuleURLs';
local.setupLocalRun(module.exports.handler,
                    local.collectionMessageInput('MOPITT_DCOSMR_LL_D_STD', localTaskName));

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
module.exports = class DownloadGranuleS3Task extends Task {
  /**
   * Main task entrypoint
   * @return An array of CMR granules that need ingest
   */

   //**TODO** this.config, this.message(.payload)
  async run() {
    const tifURLS = [
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022759_20150625010208_54990_T.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022759_20150625010208_54990_V.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022807_20150625010208_54991_T.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022807_20150625010208_54991_V.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022816_20150625010154_72558_T.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022816_20150625010154_72558_V.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022825_20150625010216_38439_T.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022825_20150625010216_38439_V.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022834_20150625010220_73343_T.tif',
      'http://e4ftl01.cr.usgs.gov//ASTER_L1T/ASTT/AST_L1T.003/2015.01.01/AST_L1T_00301012015022834_20150625010220_73343_V.tif'
    ];
    const self = this;
    tifURLS.forEach(function (url) {
      const key = url.substring(url.lastIndexOf("/")+1,url.lastIndexOf("."));
      console.time(key);
      self.urlToS3(url, 'ast-l1t-2015-granules', key, function(err, res) {
        if (err) throw err;
        console.log('Uploaded data successfully!');
        console.log('-----TIME-------');
        console.timeEnd(key);
        console.log('----------------');
      });
    });
  }

  urlToS3(url, bucket, key, callback) {

    const options = {
      url: url,
      auth: {
          'user': this.config.auth_user,
          'pass': this.config.auth_pass,
          'sendImmediately': false
      },
      jar: true,
      encoding: null
    };

    request(options, function (error, response, body) {
      if (error) {
        console.log('****ERROR in urlToS3****');
        console.log(error);
        return callback(error, response);
      }
      if (!error && response.statusCode == 200) {
        console.log('****RESPONSE 200****');
      }
      console.log(body, response.statusCode, response.headers);
      console.log('-------------------------------------------------');

      s3.putObject({
        Bucket: bucket,
        Key: key,
        ContentType: response.headers['content-type'],
        ContentLength: response.headers['content-length'],
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
    return DownloadGranuleS3Task.handle(...args);
  }
};

// To run a small test:
// node fetch-granule-urls local

const local = require('@cumulus/common/local-helpers');
const localTaskName = 'DownloadGranuleS3';
local.setupLocalRun(module.exports.handler,
                    local.collectionMessageInput('MOPITT_DCOSMR_LL_D_STD', localTaskName));

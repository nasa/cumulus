'use strict';

const { Connection } = require('@elastic/elasticsearch');
const aws4 = require('aws4');

/**
 * Builds and returns a custom subclass of Connection that is configured to sign requests
 * for AWS Elasticsearch service. Request signing is provided by the aws4 library and requires
 * valid AWS credentials.
 *
 * @param {object} awsConfig - AWS configuration values to be used to build the Connection.
 * @param {string} [awsConfig.region] - Optionally specify the AWS region in the request.
 * @param {object} awsConfig.credentials - Valid AWS credentials object.
 * @returns {AmazonConnection} - Connection configured and signed to work with AWS Elasticsearch
 * service.
 */
const createAmazonConnection = (awsConfig) => {
  class AmazonConnection extends Connection {
    constructor(opts = {}) {
      super(opts);
      if (awsConfig.credentials) {
        this.accessKeyId = awsConfig.credentials.accessKeyId;
        this.secretAccessKey = awsConfig.credentials.secretAccessKey;
      }
    }

    buildRequestObject(params) {
      const req = super.buildRequestObject(params);

      req.service = 'es';

      if (awsConfig.region) {
        req.region = awsConfig.region;
      }

      if (!req.headers) {
        req.headers = {};
      }

      // Fix the Host header, since HttpConnector.makeReqParams() appends
      // the port number which will cause signature verification to fail
      req.headers.host = req.hostname;

      // This fix allows the connector to work with the older 6.x elastic branch.
      // The problem with that version, is that the Transport object would add a
      // `Content-Length` header (yes with Pascal Case), thus duplicating headers
      // (`Content-Length` and `content-length`), which makes the signature fail.
      let contentLength = 0;
      if (params.body) {
        contentLength = Buffer.byteLength(params.body, 'utf8');
        req.body = params.body;
      }

      const lengthHeader = 'content-length';
      const headerFound = Object.keys(req.headers).find(
        (header) => header.toLowerCase() === lengthHeader
      );

      if (headerFound === undefined) {
        req.headers[lengthHeader] = contentLength;
      }

      return aws4.sign(req, awsConfig.credentials);
    }
  }

  return AmazonConnection;
};

module.exports = (awsConfig) => ({
  Connection: createAmazonConnection(awsConfig),
});

'use strict';

const AWS = require('aws-sdk');
const AwsEs = require('http-aws-es');
const Elasticsearch = require('elasticsearch');

const region = process.env.AWS_DEFAULT_REGION || 'us-west-2';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);

const isJupyter = global.__isJupyter;
const isStdin = process.argv[2] === 'stdin';
const isLocal = isJupyter || isStdin || process.env.LOCAL_NODE;

let esClient;

/**
 * A map of real AWS services to use.
 */
const realServices = {
  s3: new AWS.S3(),
  stepFunctions: new AWS.StepFunctions(),
  ecs: new AWS.ECS(),
  cf: new AWS.CloudFormation(),
  dynamoDB: new AWS.DynamoDB.DocumentClient(),

  // Getter for an elasticsearch client. It lazily constructs the client, since the host
  // may not enter the environment until a request is actually called
  get es() {
    if (esClient) return esClient;
    if (!process.env.ELASTIC_ENDPOINT) {
      throw new Error('ELASTIC_ENDPOINT must be present in the environment');
    }
    esClient = new Elasticsearch.Client({
      hosts: process.env.ELASTIC_ENDPOINT,
      connectionClass: AwsEs,
      amazonES: {
        region: region,
        credentials: isLocal ?
          new AWS.SharedIniFileCredentials({ profile: 'default' }) :
          new AWS.EnvironmentCredentials('AWS')
      }
    });
    return esClient;
  }
};

/**
 * The current set of services to use for responses
 */
let currentServices = realServices;

/**
 * Takes a map of AWS services and puts them in place. Useful for unit testing.
 */
const useReplacementServices = (serviceMap) => {
  currentServices = serviceMap;
};

/**
 * Switches back to the real services.
 */
const useRealServices = () => {
  useReplacementServices(realServices);
};

module.exports = {
  useRealServices,
  useReplacementServices,
  s3: () => currentServices.s3,
  stepFunctions: () => currentServices.stepFunctions,
  es: () => currentServices.es,
  ecs: () => currentServices.ecs,
  cf: () => currentServices.cf,
  dynamoDB: () => currentServices.dynamoDB
};

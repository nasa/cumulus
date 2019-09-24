'use strict';

const pLimit = require('p-limit');
const chunk = require('lodash.chunk');
const { Search } = require('../es/search');
const models = require('../models');

/**
 * Recursively copy all the records from elasticsearch to dynamodb
 *
 * @param {Object} Cls - the model Class for the type of data being transfered e.g. Granule
 * @param {string} index - elasticsearch index
 * @param {string} type - elasticsearch type
 * @param {integer} concurrency - number of concurrent operations
 * @param {string} page - the elasticsearch page number
 * @returns {Promise<undefined>} undefined
 */
async function copyEsToDynamoDB(Cls, index = 'cumulus', type, concurrency = 1, page = 1) {
  const limit = 100;
  const conc = pLimit(concurrency);

  const search = new Search({ queryStringParameters: { limit, page, order: 'asc' } }, type, index);
  search.client = await search.constructor.es();
  const searchParams = search._buildSearch();
  const res = await search.client.search(searchParams);

  const record = new Cls();


  // catch possible duplicate granule records
  const hash = {};
  res.body.hits.hits.forEach((s) => {
    hash[s._id] = s._source;
  });


  const records = Object.keys(hash).map((key) => hash[key]);
  const chunkedRecords = chunk(records, 25); // divide results into chunks of 25

  // add them to dynamoDB
  await Promise.all(chunkedRecords.map((c) => conc(() => record.batchWrite(null, c))));


  if (records.length === limit) {
    await copyEsToDynamoDB(Cls, index, type, concurrency, page + 1);
  }
}

/**
 * Migration's run function.
 *
 * @param {Object} options - options passed from the main runner
 * @param {Array} options.tables - list of table names to migration the data to
 * @param {string} options.elasticsearch_host - The url to the elasticsearch server
 * @param {string} options.elasticsearch_index - optional elasticsearch index name
 * @returns {Promise<string>} test message
 */
async function run(options) {
  if (!options.tables) {
    throw new Error('List of DynamoDB tables must be provided in the options');
  }

  if (!options.elasticsearch_host) {
    throw new Error('ElasticSearch host address is not provided');
  }

  if (!process.env.stackName) {
    throw new Error('stackName must be set as environment variable');
  }

  // set elasticsearch env variable
  process.env.ES_HOST = options.elasticsearch_host;

  const concurrency = 5;
  const hash = {};
  // set environment variables and associate ES type to table
  options.tables.forEach((t) => {
    const envName = t.replace(`${process.env.stackName}-`, '');
    process.env[envName] = t;
    const extraction = new RegExp(`${process.env.stackName}-(.*)sTable`);
    const extracted = extraction.exec(t);
    if (extracted) {
      hash[t] = {
        type: extracted[1].toLowerCase(),
        class: models[extracted[1]]
      };
    }
  });

  await Promise.all(options.tables.map((t) => copyEsToDynamoDB(
    hash[t].class,
    options.elasticsearch_index,
    hash[t].type,
    concurrency
  )));
}

module.exports.name = 'migration_1';
module.exports.run = run;

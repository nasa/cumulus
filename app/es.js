'use strict';

/* eslint-disable */

// A temporary helper namespace.


const { es } = require('./aws');

let p;

p = es().ping();

const stringType = {
  type: 'keyword',
  store: 'yes'
};

const dateType = {
  type: 'date',
  store: 'yes'
};

const longType = {
  type: 'long',
  store: 'yes'
};

const booleanType = {
  type: 'boolean',
  store: 'yes'
};

const createIndexRequest = {
  index: 'executions',
  body: {
    settings: {
      index: {
        number_of_shards: 5,
        number_of_replicas: 1,
        mapper: { dynamic: false }
      }
    },
    mappings: {
      execution: {
        dynamic: 'strict',
        _source: { enabled: false },
        _all: { enabled: false },
        properties: {
          workflow_id: stringType,
          collection_id: stringType,
          data_date: dateType,
          start_date: dateType,
          stop_date: dateType,
          elapsed_ms: longType,
          success: booleanType
        }
      }
    }
  }
};

p = es().indices.create(createIndexRequest);
p = es().indices.delete({ index: 'executions' });


const exampleDoc = {
  workflow_id: 'DiscoverVIIRS',
  collection_id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor_v1_NRT (VNGCR_LQD_C1)',
  data_date: '2017-05-04',
  start_date: 1493983759134,
  stop_date: 1493983782925,
  elapsed_ms: (1493983782925 - 1493983759134),
  success: true
};

p = es().create({
  index: 'executions',
  type: 'execution',
  id: 'VNGCR_LQD_C1-12ad8f4c-4292-4112-8a68-829e7197770a',
  body: exampleDoc
});


p = es().search({
  index: 'executions',
  body: {
    query: { match_all: {} },
    stored_fields: [
      'workflow_id',
      'collection_id',
      'data_date',
      'start_date',
      'stop_date',
      'elapsed_ms',
      'success'
    ]
  }
});

let searchResponse;
let searchError;
p.then(d => searchResponse=d).catch(e => searchError=e);
searchResponse
searchError

console.log(JSON.stringify(searchResponse, null, 2));


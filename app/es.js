'use strict';

// A temporary helper namespace.


const { es } = require('./aws');
const _ = require('lodash');

let p;

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

const executionsIndex = {
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
        granule_id: stringType,
        start_date: dateType,
        stop_date: dateType,
        elapsed_ms: longType,
        success: booleanType
      }
    }
  }
};

const executionsMetaIndex = {
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 1,
      mapper: { dynamic: false }
    }
  },
  mappings: {
    executionMeta: {
      dynamic: 'strict',
      _source: { enabled: true },
      _all: { enabled: false },
      properties: {
        last_indexed_date: dateType
      }
    }
  }
};

// p = es().indices.delete({ index: 'executions' });
// p = es().indices.create({
//   index: 'executions',
//   body: executionsIndex
// });
// p = es().indices.delete({ index: 'executions-meta' });
// p = es().indices.create({
//   index: 'executions-meta',
//   body: executionsMetaIndex
// });

// p = es().search({
//   index: 'executions',
//   body: {
//     query: {
//       bool: {
//         filter: { term: { granule_id: '2017129' }}
//       }
//     },
//     stored_fields: ['workflow_id', 'collection_id', 'granule_id', 'stop_date']
//   }
// });


let searchResponse;
let searchError;
p.then(d => searchResponse = d).catch(e => searchError = e);
searchResponse;
searchError;

console.log(JSON.stringify(searchResponse));

console.log(JSON.stringify(searchResponse, null, 2));

'use strict';

/* eslint-disable */

// A temporary helper namespace.


const { es } = require('./aws');

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

p = es().indices.delete({ index: 'executions' });
p = es().indices.create({
  index: 'executions',
  body: executionsIndex
});
p = es().indices.delete({ index: 'executions-meta' });
p = es().indices.create({
  index: 'executions-meta',
  body: executionsMetaIndex
});

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
          granule_id: stringType,
          start_date: dateType,
          stop_date: dateType,
          elapsed_ms: longType,
          success: booleanType
        }
      }
    }
  }
};


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


const mapScript = `
params._agg.results.add(['stop_date': doc.stop_date.value, 'success': doc.success.value])
`;

const combineScript = `
def lastResult = null;
for (r in params._agg.results) {
  if (lastResult == null) {
    lastResult = r;
  }
  else if (lastResult.stop_date < r.stop_date) {
    lastResult = r;
  }
}
return lastResult
`;

const reduceScript = `
def lastResult = null;
for (r in params._aggs) {
  if (lastResult == null) {
    lastResult = r;
  }
  else if (lastResult.stop_date < r.stop_date) {
    lastResult = r;
  }
}
return lastResult
`;



p = es().search({
  index: 'executions',
  body: {
    query: { match_all: {} },
    size: 0,
    aggs: {
      workflows: {
        terms: { field: 'workflow_id' },
        aggs: {
          recent_execs: {
            filter: { range: { stop_date: { gte: 'now-1w/d' }}},
            aggs: {
              successes: { terms: { field: 'success' }}
            }
          },
          products: {
            terms: { field: 'collection_id'},
            aggs: {
              successful: {
                filter: { term: { 'success': true }},
                aggs: {
                  // Unable to get max on string field
                  // last_granule_id: {
                  //   max: { field: 'granule_id' }
                  // }
                  last_granule_id: {
                    terms: {
                      field: 'granule_id',
                      order: { _term: 'desc'},
                      size: 1
                    }
                  },
                  last_week: {
                    filter: { range: { stop_date: { gte: 'now-1w/d' }}},
                    aggs: {
                      daily: {
                        date_histogram: {
                          field: 'stop_date',
                          // Note the timezone here is GMT
                          interval: 'day'
                        },
                        aggs: {
                          performance: {
                            percentiles: {
                              field: 'elapsed_ms',
                              percents: [95]
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              recent_execs: {
                filter: { range: { stop_date: { gte: 'now-1w/d' }}},
                aggs: {
                  successes: { terms: { field: 'success' }}
                }
              },
              last_exec: {
                scripted_metric: {
                  init_script: 'params._agg.results = []',
                  map_script: mapScript,
                  combine_script: combineScript,
                  reduce_script: reduceScript
                }
              }
            }
          }
        }
      }
    }
  }
});

p = es().search({
  index: 'executions',
  body: {
    query: {
      bool: {
        filter: { term: { granule_id: '2017129' }}
      }
    },
    stored_fields: ['workflow_id', 'collection_id', 'granule_id', 'stop_date']
  }
});


let searchResponse;
let searchError;
p.then(d => searchResponse=d).catch(e => searchError=e);
searchResponse
searchError

console.log(JSON.stringify(searchResponse));

console.log(JSON.stringify(searchResponse, null, 2));


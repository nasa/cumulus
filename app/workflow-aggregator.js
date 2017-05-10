'use strict';

const _ = require('lodash');
const { es } = require('./aws');

/**
 * TODO
 */
const mapScript = `
params._agg.results.add(['stop_date': doc.stop_date.value, 'success': doc.success.value])
`;

/**
 * TODO
 */
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

/**
 * TODO
 */
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

/**
 * TODO
 */
const successRatioAgg = {
  filter: { range: { stop_date: { gte: 'now-1w/d' } } },
  aggs: {
    successes: { terms: { field: 'success' } }
  }
};

/**
 * TODO
 */
const latestGranuleIdAgg = {
  terms: {
    field: 'granule_id',
    order: { _term: 'desc' },
    size: 1
  }
};

/**
 * TODO
 */
const ingestPerfAgg = {
  filter: { range: { stop_date: { gte: 'now-1w/d' } } },
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
};

/**
 * TODO
 */
const lastExecutionAgg = {
  scripted_metric: {
    init_script: 'params._agg.results = []',
    map_script: mapScript,
    combine_script: combineScript,
    reduce_script: reduceScript
  }
};

/**
 * TODO
 */
const productAgg = {
  terms: { field: 'collection_id' },
  aggs: {
    successful: {
      filter: { term: { success: true } },
      aggs: {
        last_granule_id: latestGranuleIdAgg,
        ingest_perf: ingestPerfAgg
      }
    },
    success_ratio: successRatioAgg,
    last_exec: lastExecutionAgg
  }
};

/**
 * TODO
 */
const workflowAgg = {
  // Aggregate by workflow
  terms: { field: 'workflow_id' },
  aggs: {
    success_ratio: successRatioAgg,
    products: productAgg
  }
};

/**
 * TODO
 */
const parseSuccessRatioAgg = (aggs) => {
  const trueBuckets = aggs.successes.buckets.filter(b => b.key_as_string === 'true');
  const trueCount = trueBuckets.reduce((c, b) => c + b.doc_count, 0);
  return { successes: trueCount, total: aggs.doc_count };
};

/**
 * TODO
 */
const parseIngestPerf = aggs =>
  aggs.daily.buckets.map(b => ({
    date: b.key_as_string,
    '95.0': b.performance.values['95.0']
  }));

/**
 * TODO
 */
const parseProductsAgg = aggs =>
  aggs.buckets.map(b => ({
    product_id: b.key,
    last_execution: b.last_exec.value,
    last_granule_id: _.get(b, 'successful.last_granule_id.buckets[0].key'),
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    ingest_perf: parseIngestPerf(b.successful.ingest_perf)
  }));

/**
 * TODO
 */
const parseWorkflowAgg = (aggs) => {
  const workflows = aggs.buckets.map(b => ({
    id: b.key,
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    products: parseProductsAgg(b.products)
  }));
  const workflowsById = {};
  workflows.forEach(w => (workflowsById[w.id] = w));
  return workflowsById;
};

/**
 * TODO
 */
const parseElasticResponse = resp =>
  parseWorkflowAgg(resp.aggregations.workflows);

/**
 * TODO
 */
const loadWorkflowsFromEs = async () => {
  const resp = await es().search({
    index: 'executions',
    body: {
      query: { match_all: {} },
      size: 0,
      aggs: { workflows: workflowAgg }
    }
  });
  return parseElasticResponse(resp);
};

module.exports = {
  loadWorkflowsFromEs,
  // For testing
  parseElasticResponse };

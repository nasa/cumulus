'use strict';


/**
 * Defines a function for searching Elasticsearch for executions and aggregating that into status
 * information about workflows and products.
 */

const _ = require('lodash');
const { es } = require('./aws');

/**
 * Part of a combination of scripts to find the last execution as a script aggregation.
 * Gets the stop date and success status from each document.
 */
const lastExecutionMapScript = `
params._agg.results.add(['stop_date': doc.stop_date.value, 'success': doc.success.value])
`;

/**
* Part of a combination of scripts to find the last execution as a script aggregation.
* Returns the last last execution from a set of results.
*/
const lastExecutionCombineScript = `
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
* Part of a combination of scripts to find the last execution as a script aggregation.
* Returns the last last execution from a set of results.
*/
const lastExecutionReduceScript = `
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
 * An aggregation that uses elasticsearch scripting to find the last execution with its success
 * status.
 */
const lastExecutionAgg = {
  scripted_metric: {
    init_script: 'params._agg.results = []',
    map_script: lastExecutionMapScript,
    combine_script: lastExecutionCombineScript,
    reduce_script: lastExecutionReduceScript
  }
};

const successRatioAgg = {
  filter: { range: { stop_date: { gte: 'now-1d/d' } } },
  aggs: {
    successes: { terms: { field: 'success' } }
  }
};

const latestGranuleIdAgg = {
  terms: {
    field: 'granule_id',
    order: { _term: 'desc' },
    size: 1
  }
};

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
            percents: [50, 95]
          }
        }
      }
    }
  }
};

const productAgg = {
  terms: { field: 'collection_id' },
  aggs: {
    success_ratio: successRatioAgg,
    successful: {
      filter: { term: { success: true } },
      aggs: {
        last_granule_id: latestGranuleIdAgg,
        ingest_perf: ingestPerfAgg
      }
    },
    last_exec: lastExecutionAgg
  }
};

/**
 * Defines an aggregation for getting workflows with nested products.
 */
const workflowAgg = {
  // Aggregate by workflow
  terms: { field: 'workflow_id' },
  aggs: {
    success_ratio: successRatioAgg,
    successful: {
      filter: { term: { success: true } },
      aggs: {
        ingest_perf: ingestPerfAgg
      }
    },
    products: productAgg
  }
};

const parseSuccessRatioAgg = (aggs) => {
  const trueBuckets = aggs.successes.buckets.filter(b => b.key_as_string === 'true');
  const trueCount = trueBuckets.reduce((c, b) => c + b.doc_count, 0);
  return { successes: trueCount, total: aggs.doc_count };
};

const parseIngestPerf = aggs =>
  aggs.daily.buckets.map((b) => {
    const values = b.performance.values;
    const percentiles = Object.keys(values);
    const dataMap = { date: b.key };
    percentiles.forEach((p) => {
      dataMap[p.replace('.0', '')] = values[p];
    });
    return dataMap;
  });

const parseProductsAgg = aggs =>
  aggs.buckets.map(b => ({
    id: b.key,
    last_execution: b.last_exec.value,
    last_granule_id: _.get(b, 'successful.last_granule_id.buckets[0].key'),
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    ingest_perf: parseIngestPerf(b.successful.ingest_perf)
  }));

const parseWorkflowAgg = (aggs) => {
  const workflows = aggs.buckets.map(b => ({
    id: b.key,
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    ingest_perf: parseIngestPerf(b.successful.ingest_perf),
    products: parseProductsAgg(b.products)
  }));
  const workflowsById = {};
  workflows.forEach(w => (workflowsById[w.id] = w));
  return workflowsById;
};

/**
 * Parses the elasticsearch response into a set of workflows with nested products.
 */
const parseElasticResponse = resp =>
  parseWorkflowAgg(resp.aggregations.workflows);

/**
 * Finds and returns workflows with products from the indexed Elasticsearch executions.
 */
const loadWorkflowsFromEs = async () => {
  const startTime = Date.now();
  const resp = await es().search({
    index: 'executions',
    body: {
      query: { match_all: {} },
      size: 0,
      aggs: { workflows: workflowAgg }
    }
  });
  // eslint-disable-next-line no-console
  console.info(`Elasticsearch Time: ${Date.now() - startTime} ms`);
  return parseElasticResponse(resp);
};

module.exports = {
  loadWorkflowsFromEs,
  // For testing
  parseElasticResponse };

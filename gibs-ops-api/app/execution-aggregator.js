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

const perfAgg = {
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
        performance: perfAgg
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
        performance: perfAgg
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

const parsePerformanceAggregation = aggs =>
  aggs.daily.buckets.map((b) => {
    const values = b.performance.values;
    const percentiles = Object.keys(values);
    const dataMap = { date: b.key };
    percentiles.forEach((p) => {
      if (values[p] !== 'NaN') {
        dataMap[p.replace('.0', '')] = values[p];
      }
    });
    return dataMap;
  });

const parseProductsAgg = aggs =>
  aggs.buckets.map(b => ({
    id: b.key,
    last_execution: b.last_exec.value,
    last_granule_id: _.get(b, 'successful.last_granule_id.buckets[0].key'),
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    performance: parsePerformanceAggregation(b.successful.performance)
  }));

const parseWorkflowAgg = (aggs) => {
  const workflows = aggs.buckets.map(b => ({
    id: b.key,
    success_ratio: parseSuccessRatioAgg(b.success_ratio),
    performance: parsePerformanceAggregation(b.successful.performance),
    products: parseProductsAgg(b.products)
  }));
  const workflowsById = {};
  // eslint-disable-next-line no-return-assign
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
  console.info(`Workflow Aggregation Elasticsearch Time: ${Date.now() - startTime} ms`);
  return parseElasticResponse(resp);
};

/**
 * Parses the results of an Elasticsearch query for executions related to a collection.
 */
const parseCollectionSearchResponse = (resp) => {
  const extractFirst = v => (v ? v[0] : v);
  const executions = resp.hits.hits.map(item => ({
    uuid: extractFirst(item.fields.execution_uuid),
    start_date: extractFirst(item.fields.start_date),
    stop_date: extractFirst(item.fields.stop_date),
    elapsed_ms: extractFirst(item.fields.elapsed_ms),
    success: extractFirst(item.fields.success),
    granule_id: extractFirst(item.fields.granule_id)
  }));
  return {
    executions,
    performance: parsePerformanceAggregation(resp.aggregations.successful.performance)
  };
};

/**
 * Finds recent executions for a collection and returns them.
 */
const getCollectionCompletedExecutions = async (workflowId, collectionId, numExecutions) => {
  const startTime = Date.now();
  const resp = await es().search({
    index: 'executions',
    body: {
      query: {
        bool: {
          must: [
            { term: { workflow_id: workflowId } },
            { term: { collection_id: collectionId } }
          ]
        }
      },
      size: numExecutions,
      sort: [{ stop_date: 'desc' }],
      stored_fields: [
        'execution_uuid',
        'workflow_id',
        'collection_id',
        'granule_id',
        'start_date',
        'stop_date',
        'elapsed_ms',
        'success'
      ],
      aggs: {
        successful: {
          filter: { term: { success: true } },
          aggs: {
            performance: perfAgg
          }
        }
      }
    }
  });
  // eslint-disable-next-line no-console
  console.info(`Collection Search Elasticsearch Time: ${Date.now() - startTime} ms`);
  return parseCollectionSearchResponse(resp);
};

module.exports = {
  loadWorkflowsFromEs,
  getCollectionCompletedExecutions,
  // For testing
  parseElasticResponse,
  parseCollectionSearchResponse,
  perfAgg
};

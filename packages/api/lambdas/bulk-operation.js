const elasticsearch = require('@elastic/elasticsearch');

const log = require('@cumulus/common/log');

const GranuleModel = require('../models/granules');
const SCROLL_SIZE = 500 // default size in Kibana

function applyWorkflowToGranules(granuleIds, workflowName, queueName) {
  const granuleModelClient = new GranuleModel();

  const applyWorkflowRequests = granuleIds.map(async (granuleId) => {
    try {
      const granule = await granuleModelClient.get({ granuleId });
      await granuleModelClient.applyWorkflow(
        granule,
        workflowName,
        queueName,
        process.env.asyncOperationId
      );
      return granuleId;
    } catch (err) {
      return { granuleId, err };
    }
  });
  return Promise.all(applyWorkflowRequests);
}

/**
 * Bulk apply workflow to either a list of granules (ids) or to a list of responses from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {string} payload.workflowName - name of the workflow that will be applied to each granule.
 * @param {string} payload.queueName - name of queue that will be used to start workflows
 * @param {Object} payload.query - Optional parameter of query to send to ES
 * @param {string} payload.index - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} payload.ids - Optional list of granule ids to bulk operate on
 */
async function bulkGranule(payload) {
  const queueName = payload.queueName;
  const workflowName = payload.workflowName;
  const granuleIds = payload.ids || [];

  // query ElasticSearch if needed
  if (granuleIds.length == 0 && payload.query){
    log.info('No granule ids detected. Searching for granules in Elasticsearch.');

    if (!process.env.METRICS_ES_HOST
      || !process.env.METRICS_ES_USER
      || !process.env.METRICS_ES_PASS) {
      throw new Error('No ELK metrics stack configured.');
    }

    const query = payload.query;
    const index = payload.index;
    const responseQueue = [];

    const esUrl = 'https://' + process.env.METRICS_ES_USER + ':' +
      process.env.METRICS_ES_PASS + '@' + process.env.METRICS_ES_HOST;
    const client = new elasticsearch.Client({
      node: esUrl
    });

    try {
      const searchResponse = await client.search({
        index: index,
        scroll: '30s',
        size: SCROLL_SIZE,
        _source: ['granuleId'],
        body: query
      });

      responseQueue.push(searchResponse);

      while(responseQueue.length){
        const { body } = responseQueue.shift();

        body.hits.hits.forEach((hit) => {
          granuleIds.push(hit._source.granuleId);
        });

        if (body.hits.total != granuleIds.length){
          responseQueue.push(
            await client.scroll({
              scrollId: body._scroll_id,
              scroll: '30s'
            })
          );
        }
      }
    } catch (e) {
      console.log("ERROR: " + e);
    }
  }

  console.log('Granule IDs: ', granuleIds);
  return applyWorkflowToGranules(granuleIds, workflowName, queueName);
}

async function handler(event) {
  if (!process.env.GranulesTable) process.env.GranulesTable = event.granulesTable;
  if (!process.env.system_bucket) process.env.system_bucket = event.system_bucket;
  if (!process.env.stackName) process.env.stackName = event.stackName;
  if (!process.env.invoke) process.env.invoke = event.invoke;
  if (event.type === 'BULK_GRANULE') {
    return bulkGranule(event.payload);
  }
  // throw an appropriate error here
  return 'Type could not be matched, no operation attempted.';
}

module.exports = {
  handler,
  bulkGranule
};

const granuleModel = require('../models/granules');
const elasticsearch = require('@elastic/elasticsearch');

/**
 * Bulk apply workflow to either a list of granules (ids) or to a list of responses from
 * ES using the provided query and index.
 * 
 * @param {Object} payload
 * @param {String} payload.workflowName - name of the workflow that will be applied to each granule.
 * @param {String} payload.queueName - name of queue that will be used to start workflows
 * @param {Object} payload.query - Optional parameter of query to send to ES
 * @param {String} payload.index - Optional parameter of ES index to query. Must exist if payload.query exists.
 * @param {Object} payload.ids - Optional list of granule ids to bulk operate on
 */
async function bulkGranule(payload) {
  const queueName = payload.queueName;
  const workflowName = payload.workflowName;
  const granuleModelClient = new granuleModel();

  console.log('ids: ', payload.ids);
  if (payload.ids && false) {
    const ids = payload.ids;
    applyWorkflowRequests = ids.map(async (granuleId) => {
      try {
        const granule = await granuleModelClient.get({ granuleId });
        await granuleModelClient.applyWorkflow(granule, workflowName, queueName);
        return granuleId;
      } catch (err) {
        return { granuleId, err };
      }
    });
    const response = await Promise.all(applyWorkflowRequests);
    console.log(response);
    return response;
  } else {
    const query = payload.query;
    const index = payload.index;
    const client = new elasticsearch.Client({
      node: process.env.METRICS_ES_HOST,
      auth: {
        username: process.env.METRICS_ES_USER,
        password: process.env.METRICS_ES_PASS
      },
    });

    console.log('Ping...');
    const pingResponse = await client.ping();
    console.log(pingResponse);
    console.log('Pong...');

    console.log('Doing the search...');
    const searchResponse = await client.search({ index, body: query });
    console.log(JSON.stringify(searchResponse));
    // Request against elastic search with pagenation
    // page through response, for each item in each page, applyWorkflow
  }

  // const client = new elasticsearch.Client({
  //   host: [
  //     {
  //       host: process.env.METRICS_ES_HOST,
  //       auth: process.env.METRICS_ES_AUTH,
  //       protocol: 'https',
  //       port: 443
  //     }
  //   ]
  // });

  // const result = await client.search({
  //   index: index,
  //   payload: query
  // });

  // console.log(result);

  // const applyWorkflowRequests = response.filter((item) => item._source.granuleId)
  //   .map(async (item) => {
  //     const granule = await granuleModelClient.get({ granuleId: item._source.granuleId });
  //     return granuleModelClient.applyWorkflow(granule, workflowName, queueName);
  //   });

  // await Promise.all(applyWorkflowRequests);
};

async function handler(event) {
  if (!process.env.GranulesTable) { process.env.GranulesTable = event.granulesTable };
  if (!process.env.system_bucket) { process.env.system_bucket = event.system_bucket };
  if (!process.env.stackName) { process.env.stackName = event.stackName };
  if (!process.env.invoke) { process.env.invoke = event.invoke };
  console.log('Environment variables:', process.env);
  if (event.type == 'BULK_GRANULE') {
    return await bulkGranule(event.payload);
  }
  const message = 'Type could not be matched, no operation attempted.'
  console.log(message);
  return message;
}

module.exports = {
  handler,
  bulkGranule
};

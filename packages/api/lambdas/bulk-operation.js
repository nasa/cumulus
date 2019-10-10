const granuleModel = require('../models/granules');

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

  const applyWorkflowRequests = ids.map(async (granuleId) => {
    try {
      const granule = await granuleModelClient.get({ granuleId });
      await granuleModelClient.applyWorkflow(granule, workflowName, queueName);
    } catch (err) {
      return { granuleId, err };
    }
  });

  const response = await Promise.all(applyWorkflowRequests);
  console.log(response);
  return response;

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

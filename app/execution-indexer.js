'use strict';

// Implements a local helper namespace to bulk index executions


require('babel-polyfill');
const { stepFunctions, es } = require('./aws');
const ws = require('./workflows');

// High level overview
// Get all the workflows
// Get all executions for each workflow
// Get details for each execution
// Convert details and execution into document
// Index all the documents

const executionToDoc = async (execution) => {
  const { workflowId, status, start_date, stop_date, arn } = execution;
  const desc = await stepFunctions().describeExecution({ executionArn: arn }).promise();
  const input = JSON.parse(desc.input);
  const startDateEpoch = Date.parse(start_date);
  const stopDateEpoch = Date.parse(stop_date);
  const dataDate = input.meta.date ? Date.parse(input.meta.date.isoDateTime) : null;

  return {
    _id: desc.name,
    workflow_id: workflowId,
    collection_id: input.meta.collection,
    data_date: dataDate,
    start_date: startDateEpoch,
    stop_date: stopDateEpoch,
    elapsed_ms: (stopDateEpoch - startDateEpoch),
    success: (status === 'SUCCEEDED')
  };
};

const docsToBulk = (docs) => {
  const bulkArgs = [];
  docs.forEach((doc) => {
    bulkArgs.push({ index: { _index: 'executions', _type: 'execution', _id: doc._id } });
    const indexDoc = Object.assign({}, doc);
    delete indexDoc._id;
    bulkArgs.push(indexDoc);
  });
  return bulkArgs;
};

const partition = (n, items) => {
  if (n >= items.length) {
    return [items];
  }
  return [items.slice(0, n)].concat(partition(n, items.slice(n)));
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// eslint-disable-next-line no-unused-vars
const indexRecentExecutions = async (stackName, numExecutions) => {
  const workflows = await ws.getWorkflowStatuses(stackName, numExecutions);
  const executions = workflows.flatMap(workflow =>
    workflow.get('executions')
      .filter(e => e.get('status') !== 'RUNNING')
      .map(e => e.set('workflowId', workflow.get('id')))
  );

  // In order to avoid the AWS Throttling we split executions into sets and then have sleeps between
  // fetching each set
  const executionSets = partition(10, executions.toArray());

  let docs = [];

  // eslint-disable-next-line no-console
  console.log(`Total of ${executionSets.length} execution sets`);

  // eslint-disable-next-line no-restricted-syntax
  for (const execSet of executionSets) {
    // eslint-disable-next-line no-console
    console.log('Fetching more docs');
    // eslint-disable-next-line no-await-in-loop
    await sleep(3000);
    // eslint-disable-next-line no-await-in-loop
    docs = docs.concat(await Promise.all(execSet.map(executionToDoc)));
  }
  // eslint-disable-next-line no-console
  console.log('Bulk saving docs');

  // const docPromises = workflows.flatMap(workflow =>
  //   workflow.get('executions')
  //     .filter(e => e.get('status') !== 'RUNNING')
  //     // This map is returning a bunch of promises
  //     .map(e => executionToDoc(workflow, e))
  // );
  // const docs = await Promise.all(docPromises);
  const bulkArgs = docsToBulk(docs);
  return es().bulk({ body: bulkArgs });
};


// const stackName = 'gitc-pq-sfn';
// const numExecutions = 10;
//
// let p = indexRecentExecutions(stackName, numExecutions)
//
// let data;
// p.then(d => data=d).catch(e => data=e);
// data
//
//
// p = es().search({
//   index: 'executions',
//   body: {
//     query: { match_all: {} },
//     stored_fields: [
//       'workflow_id',
//       'collection_id',
//       'data_date',
//       'start_date',
//       'stop_date',
//       'elapsed_ms',
//       'success'
//     ]
//   }
// });
//
// let searchResponse;
// let searchError;
// p.then(d => searchResponse=d).catch(e => searchError=e);
// searchResponse
// searchError
//
// console.log(JSON.stringify(searchResponse, null, 2))

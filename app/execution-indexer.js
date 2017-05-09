'use strict';

/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */

// Implements a local helper namespace to bulk index executions


require('babel-polyfill');
const { stepFunctions, es } = require('./aws');
const ws = require('./workflows');

// TODO the regexes here are so convoluted. They're really tied to specific GIBS id styles.
// There's no good way to know which part is absolutely the collection id and which part is the
// granule id
const withGranuleIdRegex = /^(?:[^\-^_]+-)?([A-Z0-9_]+)-([A-Z0-9_]+)-[a-z0-9\-]+$/;
const withoutGranuleIdRegex = /^([A-Z0-9_]+)-.+$/;

// let name;
// // without granules
// name = 'VNGCR_LQD_C1-000a89dd-6f3c-4876-928e-ab6736fd98e6';
// name = 'MOPITT_DCOSMR_LL_D_STD-2017-04-19_17_19_01';
// name = 'MOPITT_DCOSMR_LL_D_STD-20402140-0056-4b65-bb9d-8f3055d3dd7c';
//
// // with granules
// name = 'VIIRS-VNGCR_LQD_C1-2017126-e9792534-8721-40c4-b4fe-f046c5e4376b';
//
// name.match(withGranuleIdRegex)
// name.match(withoutGranuleIdRegex)

/**
 * TODO
 */
const executionToDoc = (workflowId, execution) => {
  const { status, startDate, stopDate, name } = execution;
  // TODO what is the first thing and are the following true?
  // example name: 'VIIRS-VNGCR_LQD_C1-2017126-e9792534-8721-40c4-b4fe-f046c5e4376b';
  // Parts of the name
  // 1. ...
  // 2. collection_id: does not contain -
  // 3. granule_id: does not contain -
  // 4. guid
  let matchResult = name.match(withGranuleIdRegex);
  if (!matchResult) {
    // If the granule id isn't in it then it may just have the collection id followed by a guid
    // Example: VNGCR_LQD_C1-000a89dd-6f3c-4876-928e-ab6736fd98e6
    // Another  MOPITT_DCOSMR_LL_D_STD-2017-04-19_17_19_01
    // TODO why does mopitt not have a guid? Is the first part the collection id?
    // TODO is it true that the collection id will never contain a dash?
    matchResult = name.match(withoutGranuleIdRegex);
    if (!matchResult) {
      throw new Error(`Found invalid execution name: ${name}`);
    }
  }
  const [_, collectionId, granuleId] = matchResult;

  const startDateEpoch = Date.parse(startDate);
  const stopDateEpoch = Date.parse(stopDate);

  return {
    _id: name,
    workflow_id: workflowId,
    collection_id: collectionId,
    granule_id: granuleId,
    start_date: startDateEpoch,
    stop_date: stopDateEpoch,
    elapsed_ms: (stopDateEpoch - startDateEpoch),
    success: (status === 'SUCCEEDED')
  };
};


/**
 * TODO
 */
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


/**
 * TODO
 */
const getLastIndexedDate = async () => {
  const resp = await es().search({
    index: 'executions-meta',
    body: {
      query: { match_all: {} },
      stored_fields: ['last_indexed_date']
    }
  });
  if (resp.hits.total > 0) {
    return Date.parse(resp.hits.hits[0].fields.last_indexed_date[0]);
  }
  return null;
};


/**
 * TODO
 */
const saveIndexedDate = async date =>
  es().index({
    index: 'executions-meta',
    type: 'executionMeta',
    id: 'executionMeta-id',
    body: {
      last_indexed_date: date
    }
  });


/**
 * The number of milliseconds before the last time we indexed that we'll continue to find and index
 * executions. Executions prior to that will be skipped.
 */
const LAST_INDEXED_THRESHOLD = 5 * 60 * 1000;

/**
 * TODO
 */
const executionBeforeLastIndexed = (lastIndexedDate, e) =>
  Date.parse(e.stopDate) < lastIndexedDate - LAST_INDEXED_THRESHOLD;


/**
 * TODO
 */
const indexExecutions = async (workflowId, executions) => {
  // Convert non-running executions to docs
  const docs = executions.filter(e => e.status !== 'RUNNING')
  .map(e => executionToDoc(workflowId, e));

  const numIndexed = docs.length;
  if (numIndexed > 0) {
    // Save them to elastic search
    const bulkArgs = docsToBulk(docs);
    const esResp = await es().bulk({ body: bulkArgs });
    // Handle errors
    if (esResp.errors !== false) {
      console.error(`esResp failed ${JSON.stringify(esResp, null, 2)}`);
      throw new Error('Failed saving to elasticsearch');
    }
  }
  return numIndexed;
};

/**
 *
 */
const indexRecentExecutions = async (stackName, maxIndexExecutions) => {
  const lastIndexedDate = await getLastIndexedDate();
  // Capture the time that we start indexing before we start fetching executions.
  const indexingStartTime = Date.now();
  const workflows = await ws.getWorkflowStatuses(stackName, 0);

  const promises = workflows.map(async (workflow) => {
    const arn = await ws.getStateMachineArn(stackName, workflow);
    const workflowId = workflow.get('id');

    console.info(`Indexing executions for workflow ${workflowId}`);
    let totalIndexed = 0;
    let done = false;
    let nextToken = null;

    while (totalIndexed < maxIndexExecutions && !done) {
      const resp = await stepFunctions()
      .listExecutions({ stateMachineArn: arn, nextToken })
      .promise();

      // Did we find any executions before the lastIndexedDate?
      const foundOlderExecutions = resp.executions.filter(e =>
        executionBeforeLastIndexed(lastIndexedDate, e)
      ).length > 0;

      const numIndexed = await indexExecutions(workflowId, resp.executions);

      if (numIndexed > 0) {
        // Decide if we're continuing to search for executions
        totalIndexed += numIndexed;
        console.info(`Indexed total of ${totalIndexed} docs for workflow ${workflowId}`);
        nextToken = resp.nextToken;

        if (foundOlderExecutions) {
          console.info('Stopping because executions were found older than last indexed date.');
        }
        if (!nextToken) {
          console.info('Stopping because no more executions were found.');
        }
        // We're done if we found older executions that are before the last time we indexed or if
        // AWS does not give us a next token meaning there's no more data to index.
        done = foundOlderExecutions || !nextToken;
      }
      else {
        console.info('Stopping because no executions were found.');
        // Nothing was found to index
        done = true;
      }

      if (totalIndexed >= maxIndexExecutions) {
        console.info('We indexed up to max index executions.');
      }
    }
  });
  // Wait until all of the workflows have been indexed
  await Promise.all(promises);
  // Record that we've indexed at least everything up to the time we started.
  await saveIndexedDate(indexingStartTime);
};

const stackName = 'gitc-pq-sfn';
let p;
p = getLastIndexedDate();
p = saveIndexedDate(Date.now() - (6 * 3600 * 1000));
p = indexRecentExecutions(stackName, 50000);

let data;
p.then(d => data = d).catch(e => data = e);
data;

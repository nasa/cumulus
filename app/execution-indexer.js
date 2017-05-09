'use strict';

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
 *
 */
const indexRecentExecutions = async (stackName, numExecutions) => {
  const workflows = await ws.getWorkflowStatuses(stackName, 0);
  const promises = workflows.map(async (workflow) => {
    const arn = await ws.getStateMachineArn(stackName, workflow);
    const workflowId = workflow.get('id');

    // eslint-disable-next-line no-console
    console.log(`Indexing executions for workflow ${workflowId}`);
    let numIndexed = 0;
    let moreExecutions = true;
    let nextToken = null;

    while (numIndexed < numExecutions && moreExecutions) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await stepFunctions()
      .listExecutions({ stateMachineArn: arn, nextToken })
      .promise();

      const docs = resp.executions.filter(e => e.status !== 'RUNNING')
      .map(e => executionToDoc(workflowId, e));

      if (docs.length > 0) {
        const bulkArgs = docsToBulk(docs);
        // eslint-disable-next-line no-await-in-loop
        const esResp = await es().bulk({ body: bulkArgs });

        if (esResp.errors !== false) {
          // eslint-disable-next-line no-console
          console.error(`esResp failed ${JSON.stringify(esResp, null, 2)}`);
          throw new Error('Failed saving to elasticsearch');
        }

        numIndexed += docs.length;
        // eslint-disable-next-line no-console
        console.log(`Indexed total of ${numIndexed} docs for workflow ${workflowId}`);
        nextToken = resp.nextToken;
        moreExecutions = !!nextToken;
      }
      else {
        moreExecutions = false;
      }
    }
  });
  await Promise.all(promises);
};


const stackName = 'gitc-pq-sfn';

let p = indexRecentExecutions(stackName, 50000);

let data;
p.then(d => data = d).catch(e => data = e);
data;

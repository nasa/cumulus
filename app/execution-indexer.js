'use strict';

/**
*  Implements a local helper namespace to bulk index executions
*/

/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */

const { stepFunctions, es } = require('./aws');
const ws = require('./workflows');
const { parseExecutionName } = require('./execution-name-parser');

const stringType = { type: 'keyword', store: 'yes' };
const dateType = { type: 'date', store: 'yes' };
const longType = { type: 'long', store: 'yes' };
const booleanType = { type: 'boolean', store: 'yes' };

/**
 * Defines settings for storing executions in Elasticsearch.
 */
const executionsIndex = {
  name: 'executions',
  type: 'execution',
  settings: {
    index: {
      // NOTE That you can't change these settings after it has been created.
      number_of_shards: 5,
      number_of_replicas: 1,
      mapper: { dynamic: false }
    }
  },
  mapping: {
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
};

/**
 * The settings to use for defining the executions meta index.
 */
const executionsMetaIndex = {
  name: 'executions-meta',
  type: 'executionMeta',
  settings: {
    index: {
      // NOTE That you can't change these settings after it has been created.
      number_of_shards: 1,
      number_of_replicas: 1,
      mapper: { dynamic: false }
    }
  },
  mapping: {
    dynamic: 'strict',
    _source: { enabled: true },
    _all: { enabled: false },
    properties: {
      last_indexed_date: dateType
    }
  }
};

/**
 * Verifies that the response from an indexing action was successful or throws an error.
 */
const verifySuccessfulIndexResponse = (resp) => {
  if (!resp.acknowledged) {
    throw new Error(`Unexpected index response: ${resp}`);
  }
};

/**
 * Creates the elasticsearch index if it doesn't exist otherwise attempts to update it.
 */
const createOrUpdateIndex = async (index) => {
  if (await es().indices.exists({ index: index.name })) {
    console.log(`${index.name} exists. Updating mappings`);
    verifySuccessfulIndexResponse(
      await es().indices.putMapping({
        index: index.name,
        type: index.type,
        body: index.mapping
      }));
  }
  else {
    console.log(`Creating ${index.name}.`);
    const mappings = {};
    mappings[index.type] = index.mapping;
    verifySuccessfulIndexResponse(
      await es().indices.create({
        index: index.name,
        body: {
          settings: index.settings,
          mappings: mappings
        } })
    );
  }
};

/**
 * Converts an execution to a document to index in elasticsearch.
 */
const executionToDoc = (workflowId, execution) => {
  const { status, startDate, stopDate, name } = execution;
  const { collectionId, granuleId } = parseExecutionName(name);
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
 * Takes a bunch of execution documents and converts them into a bulk indexing request.
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
 * Returns the date of the last time indexing was run.
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
 * Saves the date of when indexing was last run.
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
 * Returns true if the execution ended before the last indexed data minus the threshold.
 */
const executionBeforeLastIndexed = (lastIndexedDate, e) =>
  Date.parse(e.stopDate) < lastIndexedDate - LAST_INDEXED_THRESHOLD;

/**
 * Indexes the executions in elasticsearch.
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
 * The main flow. Does the following:
 *
 * 1. Makes sure that the executions and related elasticsearch indexes exists.
 * 2. Iterates through each workflow and retrieves executions from the step function API.
 * 3. Indexes the executions in Elasticsearch.
 * 4. Keeps fetching the executions and indexing them until we find executions that were already
 * indexed.
 */
const indexRecentExecutions = async (stackName, maxIndexExecutions) => {
  await createOrUpdateIndex(executionsIndex);
  await createOrUpdateIndex(executionsMetaIndex);

  const lastIndexedDate = await getLastIndexedDate();
  // Capture the time that we start indexing before we start fetching executions.
  const indexingStartTime = Date.now();
  const workflows = await ws.getWorkflowStatuses(stackName, 0);

  const promises = workflows.map(async (workflow) => {
    const arn = await ws.getStateMachineArn(stackName, workflow.get('id'));

    console.info(`Indexing executions for workflow ${workflow.get('id')}`);
    let totalIndexed = 0;
    let done = false;
    let nextToken = null; // token found in a previous run.

    while (!done) {
      const resp = await stepFunctions()
        .listExecutions({ stateMachineArn: arn, nextToken, maxResults: 1000 })
        .promise();
      const numIndexed = await indexExecutions(workflow.get('id'), resp.executions);

      if (numIndexed > 0) {
        // Did we find enough executions that we can stop?
        totalIndexed += numIndexed;
        console.info(`Indexed total of ${totalIndexed} docs for workflow ${workflow.get('id')}`);
        if (totalIndexed >= maxIndexExecutions) {
          console.info('We indexed up to max index executions.');
          done = true;
        }

        // Do we have another token to continue searching?
        nextToken = resp.nextToken;
        if (!nextToken) {
          console.info('Stopping because no more executions were found.');
          done = true;
        }

        // Did we find any executions before the lastIndexedDate?
        const foundOlderExecutions = resp.executions.filter(e =>
          executionBeforeLastIndexed(lastIndexedDate, e)
        ).length > 0;
        if (foundOlderExecutions) {
          console.info('Stopping because executions were found older than last indexed date.');
          done = true;
        }
      }
      else {
        console.info('Stopping because no executions were found.');
        done = true;
      }
    }
  });
  // Wait until all of the workflows have been indexed
  await Promise.all(promises);
  // Record that we've indexed at least everything up to the time we started.
  await saveIndexedDate(indexingStartTime);
};

const MAX_EXECUTIONS_TO_INDEX = 50000;

exports.handler = async (event, context, callback) => {
  console.log(`Indexer Handler called. Event: ${JSON.stringify(event, null, 2)}`);

  try {
    const stackName = event.StackName;
    console.log(`Starting indexing of executions for stack ${stackName}`);
    await indexRecentExecutions(stackName, MAX_EXECUTIONS_TO_INDEX);
    console.log(`Indexing complete for stack ${stackName}`);
    callback(null, 'Elasticsearch indexing complete');
  }
  catch (e) {
    console.error(e);
    callback(e.message);
  }
};

/* runs a bunch of periodic jobs to keep the database updateToDate */

'use strict';

const get = require('lodash.get');
const pLimit = require('p-limit');
const log = require('@cumulus/common/log');
const { StepFunction } = require('@cumulus/ingest/aws');
const { Search } = require('../es/search');
const { handlePayload, partialRecordUpdate } = require('../es/indexer');

async function findStaleRecords(type, q, limit = 100, page = 1) {
  const search = new Search({
    queryStringParameters: {
      q,
      page: page,
      limit: limit
    }
  }, type);
  const response = await search.query();

  //if (response.results.length >= limit) {
  //const more = await findStaleRecords(type, q, limit, page + 1);
  //return response.results.concat(more);
  //}
  return response.results;
}

async function updateGranulesAndPdrs(esClient, url, error) {
  // find related granule and update their status
  let searchTerm = `execution:"${url}"`;
  const granules = await findStaleRecords('granule', searchTerm, 100);
  await Promise.all(granules.map((g) => partialRecordUpdate(
    esClient,
    g.granuleId,
    'granule',
    { status: 'failed', error },
    g.collectionId
  )));

  // find related pdrs and update their status
  searchTerm = `execution:"${url}"`;
  const pdrs = await findStaleRecords('pdr', searchTerm, 100);
  await Promise.all(pdrs.map((p) => partialRecordUpdate(
    esClient,
    p.pdrName,
    'pdr',
    { status: 'failed', error }
  )));
}

async function checkExecution(arn, url, timestamp, esClient) {
  let error = {
    Error: 'Unknown',
    Cause: 'The error cause could not be determined'
  };
  const r = await StepFunction.getExecution(arn, true);
  r.status = r.status.toLowerCase();
  r.status = r.status === 'succeeded' ? 'completed' : r.status;


  if (r.status === 'not_found') {
    log.error(`Execution does not exist: ${arn}`);
    error = {
      Error: 'Not Found',
      Cause: 'Execution was not found. If an execution is '
             + 'finished and the state machine is deleted, this error is thrown'
    };
    await partialRecordUpdate(esClient, arn, 'execution', { status: 'failed', error });
    await updateGranulesAndPdrs(esClient, url, error);
    return;
  }

  let input = get(r, 'input');
  let output = get(r, 'output');

  if (!input) {
    return;
  }

  input = JSON.parse(input);

  try {
    output = JSON.parse(output);
  } catch (e) {
    output = input;
  }

  log.info(`Checking ${arn}`);

  if (r.status === 'running') {
    // check if it the execution has passed the five hours limit
    const now = Date.now();
    const late = (now - timestamp) > 18000000;

    if (late) {
      error = {
        Error: 'Stopped By Cumulus',
        Cause: 'Execution was stopped by Cumulus because it did not finish in 5 hours.'
      };

      await StepFunction.stop(
        arn,
        error.Cause,
        error.Error
      );

      await partialRecordUpdate(esClient, arn, 'execution', { status: 'failed', error });
      await updateGranulesAndPdrs(esClient, url, error);
    }
  } else {
    if (output.error) {
      input.exception = output.error;
      input.meta.status = 'failed';
      await handlePayload(output);
      return;
    }

    if (!output.meta) {
      output.meta = {
        status: r.status
      };
    } else {
      output.meta.status = r.status;
    }

    await handlePayload(output);
  }
}

async function cleanup() {
  const searchTerm = 'status:running';
  const esClient = await Search.es();
  const executions = await findStaleRecords('execution', searchTerm, 100);
  log.info(`Found ${executions.length} stale executions`);
  const limit = pLimit(2);
  await Promise.all(executions.slice(0, 400).map((ex) => limit(() => checkExecution(
    ex.arn,
    ex.execution,
    ex.timestamp,
    esClient
  ))));
}

function handler(event, context, cb) {
  cleanup().then(() => cb()).catch((e) => {
    log.error(e);
    cb(e);
  });
}

module.exports = { handler };

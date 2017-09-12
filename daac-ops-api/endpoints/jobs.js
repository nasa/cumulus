/* runs a bunch of periodic jobs to keep the database updateToDate */
'use strict';

const get = require('lodash.get');
const log = require('@cumulus/ingest/log');
const { StepFunction } = require('@cumulus/ingest/aws');
const { Search } = require('../es/search');
const { handlePayload } = require('../es/indexer');

async function findStaleRecords(type, q, limit = 100, page = 1) {
  const search = new Search({
    queryStringParameters: {
      q,
      page: page,
      limit: limit
    }
  }, type);
  const response = await search.query();

  if (response.results.length >= limit) {
    const more = await findStaleRecords(type, q, limit, page + 1);
    return response.results.concat(more);
  }
  return response.results;
}

async function markRecordAsFailed(esClient, id, type, status, error, p, index = 'cumulus') {
  const params = {
    index,
    type,
    id,
    body: {
      doc: {
        status,
        error,
        timestamp: Date.now()
      }
    }
  };

  if (p) {
    params.parent = p;
  }

  return esClient.update(params);
}

async function checkExecution(arn, url, esClient) {
  let error = {
    Error: null,
    Cause: null
  };
  const r = await StepFunction.getExecution(arn, true);
  r.status = r.status.toLowerCase();
  r.status = r.status === 'succeeded' ? 'completed' : r.status;

  const input = JSON.parse(get(r, 'input', '{}'));
  const output = JSON.parse(get(r, 'output', '{}'));
  const type = get(output, 'ingest_meta.workflow_name');

  if (!input) {
    return;
  }

  if (r.status === 'not_found' || r.status === 'running') {
    log.error(`Execution does not exist: ${arn}`);
    error = {
      Error: 'Timeout',
      Cause: 'Execution is aborted because it did not finish in 5 hours'
    };
    await markRecordAsFailed(esClient, arn, 'execution', 'failed', error);

    if (r.status === 'running') {
      await StepFunction.stop(
        arn,
        error.Cause,
        error.Error
      );
    }

    // find related granule and update their status
    if (type === 'IngestGranule') {
      const searchTerm = `execution:"${url}"`;
      const granules = await findStaleRecords('granule', searchTerm, 100);
      await Promise.all(granules.map(g => markRecordAsFailed(
        esClient, g.granuleId, 'granule', 'failed', error, g.collectionId
      )));
    }

    // find related pdrs and update their status
    if (type === 'ParsePdr') {
      const searchTerm = `execution:"${url}"`;
      const pdrs = await findStaleRecords('pdr', searchTerm, 100);
      await Promise.all(pdrs.map(p => markRecordAsFailed(
        esClient, p.pdrName, 'pdr', 'failed', error
      )));
    }
  }
  else {
    if (output.error) {
      input.exception = output.error;
      input.ingest_meta.status = 'failed';
      await handlePayload(output);
      return;
    }

    if (!output.ingest_meta) {
      output.ingest_meta = {
        status: r.status
      };
    }
    else {
      output.ingest_meta.status = r.status;
    }

    await handlePayload(output);
  }
}

function getHoursAgo(hours) {
  const now = Date.now();
  return now - (hours * 60 * 60 * 1000);
}

async function cleanup() {
  const fiveHoursAgo = getHoursAgo(5);
  const searchTerm = `status:running AND timestamp:<${fiveHoursAgo}`;

  const esClient = await Search.es();
  const executions = await findStaleRecords('execution', searchTerm, 100);

  log.info(`Found ${executions.length} stale executions`);

  await Promise.all(executions.map(ex => checkExecution(ex.arn, ex.execution, esClient)));
}

function handler(event, context, cb) {
  cleanup().then(() => cb()).catch(e => {
    log.error(e);
    cb(e);
  });
}

module.exports = handler;

/* runs a bunch of periodic jobs to keep the database updateToDate */
'use strict';

const log = require('@cumulus/ingest/log');
const { StepFunction } = require('@cumulus/ingest/aws');
const { Search } = require('../es/search');

async function findStaleRecords(type, timeout, limit = 100, page = 1) {
  const search = new Search({
    queryStringParameters: {
      q: `status:running AND timestamp:<${timeout}`,
      page: page,
      limit: limit
    }
  }, type);
  const response = await search.query();

  if (response.results.length >= limit) {
    const more = await findStaleRecords(type, timeout, limit, page + 1);
    return response.results.concat(more);
  }
  return response.results;
}

async function abortExecution(arn) {
  let r;
  try {
    r = await StepFunction.stop(
      arn,
      'Execution is aborted because it did not finish in 5 hours',
      'Timeout'
    );
  }
  catch (e) {
    if (e.message.includes('Execution Does Not Exist')) {
      log.error(e.message);
    }
    else {
      throw e;
    }
  }
  return r;
}

async function markRecordAsFailed(esClient, id, type, p, index = 'cumulus') {
  const params = {
    index,
    type,
    id,
    body: {
      doc: {
        status: 'failed',
        error: {
          Error: 'Timeout',
          Cause: 'Task did not finish. Cause unknown'
        },
        timestamp: Date.now()
      }
    }
  };

  if (p) {
    params.parent = p;
  }

  return esClient.update(params);
}

function getHoursAgo(hours) {
  const now = Date.now();
  return now - (hours * 60 * 60 * 1000);
}

async function cleanup() {
  const fiveHoursAgo = getHoursAgo(5);
  const tenHoursAgo = getHoursAgo(10);

  const esClient = await Search.es();
  const executions = await findStaleRecords('execution', fiveHoursAgo, 100);
  const granules = await findStaleRecords('granule', fiveHoursAgo, 100);
  const pdrs = await findStaleRecords('pdr', tenHoursAgo, 100);

  log.info(`Found ${executions.length} stale executions, ` +
           `${granules.length} stale granules, ${pdrs.length} stale pdrs`);

  await Promise.all(executions.map(ex => abortExecution(ex.arn)));
  await Promise.all(executions.map(ex => markRecordAsFailed(esClient, ex.arn, 'execution')));

  await Promise.all(
    granules.map(g => markRecordAsFailed(esClient, g.granuleId, 'granule', g.collectionId))
  );
  await Promise.all(pdrs.map(p => markRecordAsFailed(esClient, p.pdrName, 'pdr')));
}

function handler(event, context, cb) {
  cleanup().then(() => cb()).catch(e => {
    log.error(e);
    cb(e);
  });
}

module.exports = handler;

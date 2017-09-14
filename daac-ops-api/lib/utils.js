'use strict';

const { partialRecordUpdate } = require('../es/indexer');
const Rule = require('../models/rules');
const { invoke } = require('@cumulus/ingest/aws');

/**
 * A synchronous sleep/wait function
 *
 * @param {number} milliseconds number of milliseconds to sleep
 */
function sleep(milliseconds) {
  const start = new Date().getTime();
  for (let i = 0; i < 1e7; i += 1) {
    if ((new Date().getTime() - start) > milliseconds) {
      break;
    }
  }
}


function errorify(err) {
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

async function reingest(granule) {
  const collection = granule.collectionId.split('___');
  const payload = await Rule.buildPayload({
    workflow: 'IngestGranule',
    provider: granule.provider,
    collection: {
      name: collection[0],
      version: collection[1]
    },
    meta: { granuleId: granule.granuleId },
    payload: {
      granules: [{
        granuleId: granule.granuleId,
        files: granule.files
      }]
    }
  });

  await partialRecordUpdate(
    null,
    granule.granuleId,
    'granule',
    { status: 'running' },
    granule.collectionId
  );
  await invoke(process.env.invoke, payload);
  return {
    granuleId: granule.granuleId,
    action: 'reingest',
    status: 'SUCCESS'
  };
}

module.exports.sleep = sleep;
module.exports.errorify = errorify;
module.exports.reingest = reingest;

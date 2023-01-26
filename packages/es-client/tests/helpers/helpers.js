'use strict';

const range = require('lodash/range');
const pMap = require('p-map');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const indexer = require('../../indexer');

const granuleFactory = (number = 1, opts, granuleParams = {}) =>
  range(number).map(() => {
    const bucket = randomId('bucket');
    const filename = randomId('filename');
    const key = `${randomId('path')}/${filename}`;
    const factOpts = { bucket, filename, key, ...opts };
    return {
      granuleId: randomId('granule'),
      collectionId: constructCollectionId(randomId('collection'), 1),
      files: [factOpts],
      timestamp: new Date(),
      ...granuleParams,
    };
  });

const loadGranules = (granules, t) =>
  pMap(
    granules,
    (granule) => indexer.indexGranule(t.context.esClient, granule, t.context.esAlias),
    { concurrency: 10 }
  );

module.exports = {
  granuleFactory,
  loadGranules,
};

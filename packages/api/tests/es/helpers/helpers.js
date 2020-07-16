'use strict';

const range = require('lodash/range');
const pEachSeries = require('p-each-series');
const { randomId } = require('@cumulus/common/test-utils');
const { fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const indexer = require('../../../es/indexer');

const granuleFactory = (number = 1, opts) =>
  range(number).map(() => {
    const bucket = randomId('bucket');
    const filename = randomId('filename');
    const key = `${randomId('path')}/${filename}`;
    const factOpts = { bucket, filename, key, ...opts };
    return fakeGranuleFactoryV2({ files: [factOpts] });
  });

const loadGranules = async (granules, t) => {
  const loadGranule = async (granule) =>
    indexer.indexGranule(t.context.esClient, granule, t.context.esAlias);
  await pEachSeries(granules, loadGranule);
};

module.exports = {
  granuleFactory,
  loadGranules
};

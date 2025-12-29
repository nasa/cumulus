'use strict';

const test = require('ava');
const { addGranules } = require('../../../bin/serveUtils');
const {
  GranulePgModel,
  FilePgModel,
  getKnexClient,
  envParams,
  localStackConnectionEnv
} = require('@cumulus/db');
const { fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

test('addGranules add granules and associated files to Postgres', (t) => {
  const granule = fakeGranuleFactoryV2({
    files: [
      {
        bucket: 'cumulus-test-sandbox-protected',
        key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A0142558.ee5lpE.006.5112577830916.hdf',
        fileName: 's3://cumulus-test-sandbox-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A0142558.ee5lpE.006.5112577830916.hdf',
        size: 10239,
      },
      {
        bucket: 'cumulus-test-sandbox-private',
        size: 544,
        fileName: 's3://cumulus-test-sandbox-private/MOD09GQ___006/MOD/MOD09GQ.A0142558.ee5lpE.006.5112577830916.hdf.met',
        key: 'MOD09GQ___006/MOD/MOD09GQ.A0142558.ee5lpE.006.5112577830916.hdf.met',
      },
    ]
  })
});
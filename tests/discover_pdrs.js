'use strict';

const path = require('path');
const test = require('ava');
const fs = require('fs-extra');
const { fetchMessageAdapter } = require('../packages/deployment/lib/adapter');
const {
  runWorkflow,
  copyCMAToTasks,
  deleteCMAFromTasks
} = require('../packages/integration-tests/local');
const { randomString } = require('../packages/common/test-utils');
const { recursivelyDeleteS3Bucket, s3 } = require('../packages/common/aws');
const DiscoverPdrsWorkflow = require('./fixtures/workflows/DiscoverPdrs.json');
const IngestGranuleWorkflow = require('./fixtures/workflows/IngestGranule.json');
const localFTPProvider = require('./fixtures/providers/local_ftp_provider.json');
const mod09gq = require('./fixtures/collections/MOD09GQ.json');

// unfortunately t.context is not available in test.before
// this is fixed in ava 1.0.0 but it has a lot of breaking
// changes. The global variables below help with passing messages
// around between before and after hooks.
let internal;
let src;
let dest;
const cmaFolder = 'cumulus-message-adapter';


test.before(async(t) => {
  internal = randomString();
  await s3().createBucket({ Bucket: internal }).promise();

  // download and unzip the message adapter
  const gitPath = 'cumulus-nasa/cumulus-message-adapter';
  const filename = 'cumulus-message-adapter.zip';
  src = path.join(process.cwd(), 'tests', 'adapter.zip');
  dest = path.join(process.cwd(), 'tests', cmaFolder); 
  await fetchMessageAdapter(null, gitPath, filename, src, dest);
});

test('DiscoverPdr Workflow with FTP provider', async (t) => {

  try {
    // copy cumulus-message-adapter
    await copyCMAToTasks(DiscoverPdrsWorkflow, dest, cmaFolder);

    const msg = await runWorkflow(DiscoverPdrsWorkflow, mod09gq, localFTPProvider, internal); 

    // discover-pdr must return a list of PDRs
    const pdrs = msg.output.payload.pdrs;
    t.true(Array.isArray(pdrs));
    t.is(pdrs.length, 4);
  }
  finally {
    // remove cumulus-message-adapter from tasks
    await deleteCMAFromTasks(DiscoverPdrsWorkflow, cmaFolder);
  }
});

test.after.always('final cleanup', async(t) => {
  await recursivelyDeleteS3Bucket(internal);
  await fs.remove(src);
  await fs.remove(dest);
});

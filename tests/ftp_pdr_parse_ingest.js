'use strict';

const test = require('ava');
const fs = require('fs-extra');
const {
  runWorkflow,
  downloadCMA,
  copyCMAToTasks,
  deleteCMAFromTasks,
  messageBuilder
} = require('../packages/integration-tests/local');
const { randomString } = require('../packages/common/test-utils');
const {
  createQueue,
  recursivelyDeleteS3Bucket,
  s3,
  sqs,
  receiveSQSMessages
} = require('../packages/common/aws');
const { CollectionConfigStore } = require('../packages/common');
const workflowSet = require('./fixtures/workflows/pdr_parse_ingest.json');
const collections = require('./fixtures/collections.json');
const providers = require('./fixtures/providers.json');

// unfortunately t.context is not available in test.before
// this is fixed in ava 1.0.0 but it has a lot of breaking
// changes. The global variables below help with passing messages
// around between before and after hooks.
const context = {};
const cmaFolder = 'cumulus-message-adapter';


test.before(async () => {
  context.internal = randomString();
  context.stack = randomString();
  context.templates = {};
  await s3().createBucket({ Bucket: context.internal }).promise();

  const collectionConfigStore = new CollectionConfigStore(context.internal, context.stack);
  await Promise.all([
    collectionConfigStore.put('MOD09GQ', '006', { name: 'MOD09GQ', granuleExtractionId: '(.*)' }),
    collectionConfigStore.put('AST_L1A', '6', { name: 'AST_L1A', granuleExtractionId: '(.*)' }),
    collectionConfigStore.put('MOD87GQ', '006', { name: 'MOD87GQ', granuleExtractionId: '(.*)' }),
    collectionConfigStore.put('MYD13A1', '006', { name: 'MYD13A1', granuleExtractionId: '(.*)' })
  ]);

  // download and unzip the message adapter
  const { src, dest } = await downloadCMA();
  context.src = src;
  context.dest = dest;

  // create the queue
  context.queueUrl = await createQueue();

  const config = {
    buckets: {
      internal: {
        name: context.internal,
        type: 'internal'
      }
    },
    system_bucket: context.internal,
    stack: context.stack,
    stepFunctions: {},
    sqs: {}
  };

  const cfOutputs = [{
    OutputKey: 'startSFSQSOutput',
    OutputValue: context.queueUrl
  }];

  // create workflow templates
  Object.keys(workflowSet).forEach((w) => {
    config.stepFunctions[w] = {};
  });

  const promises = Object.keys(workflowSet).map((w) => {
    context.templates[w] = messageBuilder(workflowSet[w], config, cfOutputs);
    return s3().putObject({
      Bucket: context.internal,
      Key: `${context.stack}/workflows/${w}.json`,
      Body: JSON.stringify(context.templates[w])
    }).promise();
  });

  // upload templates
  await Promise.all(promises);
});

test.serial('Discover and queue PDRs with FTP provider', async (t) => {
  const workflow = workflowSet.DiscoverPdrs;
  t.context.workflow = workflow;
  const input = context.templates.DiscoverPdrs;
  // copy cumulus-message-adapter
  await copyCMAToTasks(workflow, context.dest, cmaFolder);

  input.meta.collection = collections[workflow.collection];
  input.meta.provider = providers.ftp;
  const msg = await runWorkflow(workflow, input);

  // discover-pdr must return a list of PDRs
  const pdrs = msg.stepOutputs.DiscoverPdrs.payload.pdrs;
  t.true(Array.isArray(pdrs));
  t.is(pdrs.length, 5);

  t.is(msg.output.payload.pdrs_queued, pdrs.length);
});

test.serial('Parse Pdrs from the previous step', async (t) => {
  const workflow = workflowSet.ParsePdr;
  t.context.workflow = workflow;

  // copy cumulus-message-adapter
  await copyCMAToTasks(workflow, context.dest, cmaFolder);

  const messages = await receiveSQSMessages(context.queueUrl, { numOfMessages: 4 });

  await Promise.all( // eslint-disable-line function-paren-newline
    messages.map(async (input) => {
      const msg = await runWorkflow(workflow, input.Body);
      t.truthy(msg.input.payload.pdr);
      t.is(
        msg.output.payload.granules.length,
        msg.output.payload.granulesCount
      );
    }));
});

test.afterEach.always(async (t) =>
  deleteCMAFromTasks(t.context.workflow, cmaFolder));

test.after.always('final cleanup', () =>
  Promise.all([
    recursivelyDeleteS3Bucket(context.internal),
    sqs().deleteQueue({ QueueUrl: context.queueUrl }).promise(),
    fs.remove(context.src),
    fs.remove(context.dest)
  ]));

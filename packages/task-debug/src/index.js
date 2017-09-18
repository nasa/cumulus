'use strict';

// Let everyone know that this is a debug session
global.__isDebug = true;

const log = require('@cumulus/common/log');
const program = require('commander');
const workflow = require('./workflow');
const local = require('@cumulus/common/local-helpers');

const increaseVerbosity = (_v, total) => total + 1;

const doDebug = async () => {
  const configFile = program.configFile;
  const collectionId = program.collection;
  const workflowName = program.workflow;
  const bucket = program.bucket;

  log.info(`Config file: ${configFile}`);
  log.info(`Collection: ${collectionId}`);
  log.info(`Workflow: ${workflowName}`);
  log.info(`S3 Bucket: ${bucket}`);

  const workflows = local.parseWorkflows(collectionId);
  const wf = workflows[workflowName];
  const resources = {
    buckets: {
      private: bucket
    }
  };

  const result = await workflow.runWorkflow(collectionId, wf, resources);

  log.info(`RESULT: ${JSON.stringify(result)}`);
};

// const workflows = local.parseWorkflows('VNGCR_LQD_C1_SIPS');
// const discoverPdrsWorkflow = workflows.DiscoverPdrsSIPSTEST;
// const resources = {
//   buckets: {
//     private: 'gitc-jn-private'
//   }
// };

// const result = workflow.runWorkflow('VNGCR_LQD_C1_SIPS', discoverPdrsWorkflow, resources);

// log.info(`RESULT: ${result}`);

program
  .version('0.0.1')
  .option('-v, --verbose', 'A value that can be increased', increaseVerbosity, 0)
  .option('-c, --collection <value>', 'The ID of the collection to process')
  .option('-w, --workflow <value>', 'The workflow to run')
  .option('-b, --bucket [value]', 'The private S3 bucket to use')
  .command('debugg <config-file>')
  .action(doDebug);

program.parse(process.argv);

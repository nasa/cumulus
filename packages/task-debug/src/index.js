'use strict';

// Let everyone know that this is a debug session
global.__isDebug = true;

const log = require('@cumulus/common/log');
const program = require('commander');
const workflow = require('./workflow');
const local = require('@cumulus/common/local-helpers');

// Tasks we need for our step function
// const DiscoverPdrTask = require('../../../cumulus/tasks/discover-pdr');
// const TriggerProcessPdrsTask = require('../../../cumulus/tasks/trigger-process-pdrs');

const increaseVerbosity = (_v, total) => total + 1;

const doDebug = configFile => {
  log.info(`Config file: ${configFile}`);
  // const localTaskName = 'DiscoverPdr';
  // const inputMessageFun = local.collectionMessageInput('VNGCR_LQD_C1_SIPS', localTaskName);
  // DiscoverPdrTask.handler(inputMessageFun, {}, (result) => result);
  log.info(`Verbosity: ${program.verbose}`);
};

const workflows = local.parseWorkflows('VNGCR_LQD_C1_SIPS');
const discoverPdrsWorkflow = workflows.DiscoverPdrsSIPSTEST;
const resources = {
  buckets: {
    private: 'gitc-jn-private'
  }
};

const result = workflow.runWorkflow('VNGCR_LQD_C1_SIPS', discoverPdrsWorkflow, resources);



log.info(`RESULT: ${result}`);

// log.info(`WORKFLOW: ${JSON.stringify(workflows)}`);

// const message = workflow.genMessage('VNGCR_LQD_C1_SIPS', 'DiscoverPdr')();
// log.info(`MESSAGE: ${message}`);

// const rval = workflow.runTask(
//   DiscoverPdrTask.handler,
//   workflow.genMessage('VNGCR_LQD_C1_SIPS', 'DiscoverPdr', {
//     buckets: {
//       private: 'gitc-jn-private'
//     }
//   })
// );

// rval.then(results => {
//   log.info(JSON.stringify(results));
//   const res = workflow.runTask(
//     TriggerProcessPdrsTask.handler,
//     workflow.genMessage('VNGCR_LQD_C1_SIPS', 'TriggerProcessPdrs', results)
//   );
//   res.then(r => {
//     log.info(JSON.stringify(r));
//   });
// });

// local.setupLocalRun(
//   DiscoverPdrTask.handler,
//   local.collectionMessageInput('VNGCR_LQD_C1_SIPS', localTaskName, o => Object.assign({}, o, {
//     resources: {
//       buckets: {
//         private: 'gitc-jn-private'
//       }
//     }
//   }))
// );

program
  .version('0.0.1')
  .option('-v, --verbose', 'A value that can be increased', increaseVerbosity, 0)
  .command('debugg <config-file>')
  .action(doDebug);

program.parse(process.argv);

'use strict';

// Let everyone know that this is a debug session
global.__isDebug = true;

const log = require('@cumulus/common/log');
const program = require('commander');
const local = require('@cumulus/common/local-helpers');

// Tasks we need for our step function
const DiscoverPdrTask = require('../../../cumulus/tasks/discover-pdr');
const TriggerProcessPdrsTask = require('../../../cumulus/tasks/trigger-process-pdrs');

const increaseVerbosity = (_v, total) => total + 1;

/**
 * Run a task locally with given message and return ouptput message for next stage
 * @param {Function} handler Function that executes a task
 * @param {Function} invocation Function that returns the message for a task
 * @return {*} The result from the execution
 */
const runTask = (handler, invocation) => handler(invocation(), {}, result => result);

const doDebug = configFile => {
  log.info(`Config file: ${configFile}`);
  // const localTaskName = 'DiscoverPdr';
  // const inputMessageFun = local.collectionMessageInput('VNGCR_LQD_C1_SIPS', localTaskName);
  // DiscoverPdrTask.handler(inputMessageFun, {}, (result) => result);
  log.info(`Verbosity: ${program.verbose}`);
};

/**
 *
 * @param {string} taskName
 * @param {*} payload
 */
const genMessage = (taskName, resources = {}, payload = null) =>
  local.collectionMessageInput('VNGCR_LQD_C1_SIPS', taskName, o =>
    Object.assign({}, o, {
      resources: resources,
      payload: payload
    })
  );

const message = genMessage('DiscoverPdr');
log.info(`MESSAGE: ${message}`);

const rval = runTask(
  DiscoverPdrTask.handler,
  genMessage('DiscoverPdr', {
    buckets: {
      private: 'gitc-jn-private'
    }
  })
);

rval.then(results => {
  log.info(JSON.stringify(results));
  const res = runTask(TriggerProcessPdrsTask.handler, genMessage('TriggerProcessPdrs', results));
  res.then(r => {
    log.info(JSON.stringify(r));
  });
});

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

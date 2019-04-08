const fs = require('fs');
const path = require('path');
const configUtil = require('./config');
const log = require('./log');
const { deprecate } = require('./util');

const isMocha = process.argv[1] && process.argv[1].includes('mocha-webpack');

// Defines whether we're in a Jupyter context or not as used with the Atom editor from Hydrogen
// plugin. This is not set by Jupyter or Hydrogen and must be manually configured in Hydrogen
// startup code settings with {"Javascript (Node.js)": "global.__isJupyter = true;"}
const isJupyter = global.__isJupyter;

// Defines whether we're running a debugging session or not
const isDebug = global.__isDebug;

// Defines whether we're in an AVA test
const isAva = process.argv[1] && /ava/.test(process.argv[1]);

const isStdin = process.argv[2] === 'stdin';
const isLocal = isDebug || isJupyter || isStdin || process.argv[2] === 'local';
exports.isLocal = isLocal;

let rootPath;
if (isMocha) {
  rootPath = '../../../..';
}
else if (isJupyter || isAva || isDebug) {
  rootPath = '../..';
}
else {
  rootPath = '../../..';
}

const fileRoot = () => path.join(__dirname, rootPath);

/**
 * Helper for changing the root path for local testing.
 *
 * @param {*} newPath
 */
const changeRootPath = (newPath) => {
  rootPath = newPath;
};

exports.fileRoot = fileRoot;
exports.changeRootPath = changeRootPath;

const findById = (arr, id) => {
  const item = arr.find((i) => i.id === id);
  if (item) return item;

  throw new Error(`id not found: ${id}`);
};

/**
 * Returns the workflows defined in a yml configuration file
 *
 * @param {string} id - The collection id to read from collections.yml
 * @param {string} configFile - The path to the yml file containing the configuration
 * @returns {Object} A map containing descriptions of each workflow
 */
exports.parseWorkflows = (id, configFile = null) => {
  const configPath = configFile || `${fileRoot()}/packages/common/test/config/test-collections.yml`;
  log.info(`CONFIG PATH: ${configPath}`);
  const configStr = fs.readFileSync(configPath).toString();
  const config = configUtil.parseConfig(configStr, (resource) => resource);
  return config.workflows;
};

/**
 * Returns a dummy message for a collection of the given id, used for local testing,
 * with information obtained by reading collections.yml
 *
 * @param {string} id - The collection id to read from collections.yml
 * @param {string} taskName - The config key to lookup to find task config
 * @param {function} payload - A function which takes the message and can override its fields
 * @param {string} configFile - Path to the yml file containing the configuration
 * @returns {Object} - The config object
 */
exports.collectionMessageInput = (id, taskName, payload = (o) => o, configFile = null) => () => {
  if (!isLocal && !isMocha && !isJupyter && !isAva) return null;
  const configPath = configFile || `${fileRoot()}/packages/common/test/config/test-collections.yml`;
  log.info(`CONFIG PATH: ${configPath}`);
  const configStr = fs.readFileSync(configPath).toString();
  const config = configUtil.parseConfig(configStr, (resource) => resource);

  const collection = findById(config.collections, id);

  const taskConfig = {};
  Object.keys(collection.workflow_config_template).forEach((key) => {
    const localTaskConfig = Object.assign({}, collection.workflow_config_template[key]);
    if (localTaskConfig.connections) {
      log.info(`Removing connection limit for local run of ${key}`);
      delete localTaskConfig.connections;
    }
    taskConfig[key] = localTaskConfig;
  });

  const input = {
    workflow_config_template: taskConfig,
    resources: {
      stack: 'some-stack',
      state_machine_prefix: 'some-prefix',
      buckets: {
        config: {
          name: 'some-stack-config',
          type: 'public'
        },
        private: {
          name: 'some-stack-private',
          type: 'private'
        },
        public: {
          name: 'some-stack-public',
          type: 'public'
        }
      },
      tables: {
        connections: 'some-stack-connects',
        locks: 'some-stack-locks'
      }
    },
    provider: findById(config.providers, collection.provider_id),
    ingest_meta: {
      task: taskName,
      message_source: 'local',
      id: 'id-1234'
    },
    meta: collection.meta
  };
  return Object.assign(input, payload(input));
};

/**
 * Sets up a local execution of the given handler.
 *
 * @param {function} handler - The Lambda message handler
 * @param {function} invocation - A function which returns the Lambda input
 * @returns {undefined} none
 */
exports.setupLocalRun = (handler, invocation) => {
  deprecate('@cumulus/common/local-helpers.justLocalRun', '1.12.0');
  if (isLocal) {
    handler(invocation(), {}, (result) => result);
  }
};


/**
 * Similar to setupLocalRun except that it only
 * calls the passed function if it is a local run
 *
 * @param {function} fn - A function to call
 * @returns {undefined} none
 */
exports.justLocalRun = (fn) => {
  deprecate('@cumulus/common/local-helpers.justLocalRun', '1.12.0');
  if (isLocal) {
    fn();
  }
};

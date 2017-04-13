const fs = require('fs');
const configUtil = require('./config');
const path = require('path');
const log = require('./log');

const isMocha = process.argv[1] && process.argv[1].includes('mocha-webpack');

// Defines whether we're in a Jupyter context or not as used with the Atom editor from Hydrogen
// plugin. This is not set by Jupyter or Hydrogen and must be manually configured in Hydrogen
// startup code settings with {"Javascript (Node.js)": "global.__isJupyter = true;"}
const isJupyter = global.__isJupyter;

const isStdin = process.argv[2] === 'stdin';
const isLocal = isStdin || process.argv[2] === 'local';
exports.isLocal = isLocal;

let rootPath;
if (isMocha) {
  rootPath = '../../..';
}
else if (isJupyter) {
  rootPath = '..';
}
else {
  rootPath = '../..';
}

const fileRoot = () => path.join(__dirname, rootPath);

exports.fileRoot = fileRoot;

const findById = (arr, id) => {
  for (const item of arr) {
    if (item.id === id) return item;
  }
  throw new Error(`id not found: ${id}`);
};

exports.collectionEventInput = (id, taskName, payload = (o) => o) => () => {
  if (!isLocal && !isMocha && !isJupyter) return null;
  const configStr = fs.readFileSync(`${fileRoot()}/config/collections.yml`).toString();
  const config = configUtil.parseConfig(configStr, (resource) => resource);

  const collection = findById(config.collections, id);

  const taskConfig = {};
  for (const key of Object.keys(collection.task_config)) {
    const localTaskConfig = Object.assign({}, collection.task_config[key]);
    if (localTaskConfig.connections) {
      log.info(`Removing connection limit for local run of ${key}`);
      delete localTaskConfig.connections;
    }
    taskConfig[key] = localTaskConfig;
  }

  const input = {
    task_config: taskConfig,
    resources: {
      stack: 'some-stack',
      state_machine_prefix: 'some-prefix',
      buckets: {
        config: 'some-stack-config',
        private: 'some-stack-private',
        public: 'some-stack-public'
      },
      tables: {
        connections: 'some-stack-connects',
        locks: 'some-stack-locks'
      }
    },
    provider: findById(config.providers, collection.provider_id),
    ingest_meta: {
      task: taskName,
      event_source: 'local',
      start_date: new Date().toISOString()
    },
    meta: collection.meta
  };
  return Object.assign(input, payload(input));
};

exports.setupLocalRun = (handler, invocation) => {
  if (isLocal) {
    handler(invocation(), {}, (result) => result);
  }
};

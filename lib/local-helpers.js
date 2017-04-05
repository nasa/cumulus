const fs = require('fs');
const collections = require('./collections');
const path = require('path');

const isMocha = process.argv[1] && process.argv[1].endsWith('mocha-webpack');

const isLocal = process.argv[2] === 'local';

const fileRoot = () => path.join(__dirname, isMocha ? '../../..' : '../..');

exports.collection = (id = 'VNGCR_SQD_C1') =>
  collections.parseCollectionsById(
    fs.readFileSync(`${fileRoot()}/config/collections.json`).toString(),
    fs.readFileSync(`${fileRoot()}/config/providers.json`).toString()
  )[id];


exports.taskInput = (extra = () => {}) => {
  if (!isLocal && !isMocha) return null;
  return Object.assign({
    local: true,
    resources: {
      stack: 'some-stack',
      eventQueues: {
        'ingest-needed_http-tiles': 'http://example.com/tile-queue',
        'ingest-needed_cmr-granules': 'http://example.com/cmr-queue'
      },
      buckets: {
        config: 'some-stack-config',
        private: 'some-stack-private',
        public: 'some-stack-public'
      }
    },
    config: {
      collections: fs.readFileSync(`${fileRoot()}/config/collections.json`).toString(),
      providers: fs.readFileSync(`${fileRoot()}/config/providers.json`).toString(),
      events: fs.readFileSync(`${fileRoot()}/config/events.json`).toString()
    }
  }, extra());
};

exports.collectionEventInput = (id, payload = (o) => o) => () => {
  const collection = exports.collection(id);
  const input = Object.assign(exports.taskInput(), {
    collection: collection,
    transaction: collection.meta,
    meta: collection.meta
  });
  return Object.assign(input, { config: collection.ingest.config }, payload(input));
};

exports.setupLocalRun = (handler, invocation) => {
  if (isLocal) {
    handler(invocation(), {}, (result) => result);
  }
};

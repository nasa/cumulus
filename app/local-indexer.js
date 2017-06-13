'use strict';

/**
 * The runner for running the indexer as a node task. Runs forever pausing between indexing runs.
 */

/* eslint no-console: ["error", { allow: ["error", "info"] }] */

const ExecutionIndexer = require('./execution-indexer');

const stackName = process.env.STACK_NAME;
const indexFrequencySecs = process.env.INDEX_FREQUENCY_SECS || 10;

if (!stackName) {
  throw new Error('The STACK_NAME must be configured as an environment variable.');
}

const indexExecutions = async () => {
  try {
    const startTime = Date.now();
    console.info(`Starting indexing of executions for stack ${stackName}`);
    await ExecutionIndexer.findAndIndexExecutions(stackName);
    console.info(`Indexing complete for stack ${stackName} in ${Date.now() - startTime} ms.`);
  }
  catch (e) {
    console.error(e);
  }
  setTimeout(indexExecutions, indexFrequencySecs * 1000);
};

const main = async () => {
  console.info('Creating or updating indexes');
  await ExecutionIndexer.createOrUpdateExecutionIndexes();
  console.info(`Starting indexing forever with frequency of ${indexFrequencySecs}`);
  return indexExecutions();
};

main().catch((e) => {
  console.error(e);
  console.error('Error forcing shutdown of indexer');
});

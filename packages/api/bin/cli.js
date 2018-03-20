#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const pckg = require('../package.json');
const es = require('./es');
const program = require('commander');

program.version(pckg.version);

/**
 * Verify that the given param is not null. Write out an error if null.
 *
 * @param {Object} paramConfig - param name and value {name: value:}
 * @returns {boolean} true if param is not null
 */
function verifyRequiredParameter(paramConfig) {
  if (paramConfig.value === null) {
    console.log(`Error: ${paramConfig.name} is a required parameter.`);
    return false;
  }

  return true;
}

/**
 * Verify required parameters are present
 *
 * @param {list<Object>} requiredParams - params in the form {name: 'x' value: 'y'}
 * @returns {boolean} - true if all params are not null
 */
function verifyWorkflowParameters(requiredParams) {
  return requiredParams.map(verifyRequiredParameter).includes(false) === false;
}

program
  .usage('TYPE COMMAND [options]');

program
  .command('reindex')
  .description('Reindex elasticsearch index to a new destination index')
  .option('-a, --index-alias <alias>', 'AWS Elasticsearch index alias', 'cumulus-alias')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source <sourceIndex>', 'Index to reindex', 'cumulus')
  .option('-d, --dest-index <destIndex>', 'Name of the destination index, should not be an existing index', null)
  .action(() => {
    es.reindex();
    // if (verifyWorkflowParameters([{ name: 'stack-name', value: program.stackName },
    //                               { name: 'bucket-name', value: program.bucketName },
    //                               { name: 'workflow', value: program.workflow },
    //                               { name: 'input-file', value: program.inputFile }])) {
    //   testRunner.testWorkflow(program.stackName, program.bucketName,
    //                           program.workflow, program.inputFile);
    // }
  });

program
  .command('status')
  .description('get the status of the reindex task')
  .action(() => {
    es.getStatus();
  });

program
  .command('complete-reindex')
  .description('description')
  .action(() => {
    es.completeReindex();
  });

program
  .parse(process.argv);

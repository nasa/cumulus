#!/usr/bin/env node

'use strict';

const pckg = require('../package.json');
const program = require('commander');
const testRunner = require('..');

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
  .usage('TYPE COMMAND [options]')
  .option('-s, --stack-name <stackName>', 'AWS Cloud Formation stack name', null)
  .option('-b, --bucket-name <bucketName>', 'AWS S3 internal bucket name', null)
  .option('-w, --workflow <workflow>', 'Workflow name', null)
  .option('-i, --input-file <inputFile>', 'Workflow input JSON file', null);

program
  .command('workflow')
  .description('Execute a workflow and determine if the workflow completes successfully')
  .action(() => {
    if (verifyWorkflowParameters([{ name: 'stack-name', value: program.stackName },
      { name: 'bucket-name', value: program.bucketName },
      { name: 'workflow', value: program.workflow },
      { name: 'input-file', value: program.inputFile }])) {
      testRunner.testWorkflow(
        program.stackName, program.bucketName,
        program.workflow, program.inputFile
      );
    }
  });

program
  .parse(process.argv);

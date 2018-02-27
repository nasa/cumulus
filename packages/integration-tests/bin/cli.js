#!/usr/bin/env node

'use strict';

const pckg = require('../package.json');
const testRunner = require('../index');
const program = require('commander');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]')
  .option('-s, --stack-name <stackName>', 'AWS Cloud Formation stack name', null)
  .option('-b, --bucket-name <bucketName>', 'AWS S3 internal bucket name', null)
  .option('-w, --workflow <workflow>', 'Workflow name', null)
  .option('-i, --input-file <inputFile>', 'Workflow input JSON file', null);

program
  .command('workflow')
  .action(() => {
    testRunner.testWorkflow(program.stackName, program.bucketName,
                            program.workflow, program.inputFile);
  });

program
  .parse(process.argv);

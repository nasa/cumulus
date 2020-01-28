#!/usr/bin/env node

'use strict';

const program = require('commander');
const pckg = require('../package.json');

const stateFile = require('../src/stateFile');
const inventory = require('../src/inventory');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]');

program
  .command('list-deployments')
  .description('List Terraform Cumulus deployments in the account')
  .option('--regex <regex>', 'Regular expression string to use for extracting deployment name from bucket/key. Defaults to \'.*\/(.*)\/(data-persistence.*|cumulus.*)\/terraform.tfstate/\'')
  .action(async (cmd) => {
    const stateFiles = await stateFile.listTfStateFiles();
    console.log(stateFile.listTfDeployments(stateFiles, cmd.regex));
  });

program
  .command('deployment-report')
  .description('List each Cumulus deployment with files, number of resources, and last update date')
  .option('--regex <regex>', 'Regular expression string to use for extracting deployment name from bucket/key. Defaults to \'.*\/(.*)\/(data-persistence.*|cumulus.*)\/terraform.tfstate/\'')
  .action(async (cmd) => {
    const deployments = await stateFile.deploymentReport(cmd.regex);
    const sortedKeys = Object.keys(deployments).sort();
    sortedKeys.forEach((k) => {
      console.log(k);
      console.log(deployments[k]);
    });
  });

program
  .command('list-orphaned-resources')
  .description('List resources not associated with a Terraform deployment, currently supports ECS, EC2, and Elasticsearch')
  .action(async () => {
    console.log(await inventory.reconcileResources());
  });

program
  .parse(process.argv);

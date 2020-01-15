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
  .action(async () => {
    const stateFiles = await stateFile.listTfStateFiles();
    console.log(stateFile.listTfDeployments(stateFiles));
  });

program
  .command('deployment-report')
  .description('List each Cumulus deployment with files, number of resources, and last update date')
  .action(async () => {
    const deployments = await stateFile.deploymentReport();
    const sortedKeys = Object.keys(deployments).sort();
    sortedKeys.forEach((k) => {
      console.log(k);
      console.log(deployments[k]);
    });
  });

program
  .command('list-orphaned-resources')
  .description('List resources not associated with a Terraform deployment, currently supports ECS and EC2')
  .action(async () => {
    console.log(await inventory.reconcileResources());
  });

program
  .parse(process.argv);

#!/usr/bin/env node

'use strict';

const program = require('commander');
const pckg = require('../package.json');
const backup = require('./backup');
const restore = require('./restore');
const { serveApi, serveDistributionApi } = require('./serve');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]');

program
  .command('backup')
  .option('--table <table>', 'AWS DynamoDB table name')
  .option('--region <region>', 'AWS region name (default: us-east-1)')
  .option(
    '--directory <directory>',
    'The directory to save the backups to. Defaults to backups in the current directory'
  )
  .description('Backup a given AWS folder to the current folder')
  .action((cmd) => {
    if (!cmd.table) {
      throw new Error('table name is missing');
    }

    backup(cmd.table, cmd.region, cmd.directory).then(console.log).catch(console.error);
  });

program
  .command('restore <file>')
  .option('--table <table>', 'AWS DynamoDB table name')
  .option('--region <region>', 'AWS region name (default: us-east-1)')
  .option('--concurrency <concurrency>', 'Number of concurrent calls to DynamoDB. Default is 2')
  .description('Backup a given AWS folder to the current folder')
  .action((file, cmd) => {
    if (!cmd.table) {
      throw new Error('table name is missing');
    }

    const concurrency = !cmd.concurrency ? 2 : Number.parseInt(cmd.concurrency, 10);

    if (cmd.region) {
      process.env.AWS_DEFAULT_REGION = cmd.region;
    }

    restore(file, cmd.table, concurrency).then(console.log).catch(console.error);
  });

program
  .command('serve')
  .option('--stackName <stackName>', 'stackname to serve (defaults to "localrun")', undefined)
  .option('--no-reseed', 'do not reseed dynamoDB and Elasticsearch with new data on start.')
  .description('Serves the local version of the Cumulus API')
  .action((cmd) => {
    serveApi(process.env.USERNAME, cmd.stackName, cmd.reseed).catch(console.error);
  });

program
  .command('serve-dist')
  .description('Serves the local version of the distribution API')
  .action(() => {
    serveDistributionApi(process.env.stackName).catch(console.error);
  });

program
  .parse(process.argv);

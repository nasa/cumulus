#!/usr/bin/env node

'use strict';

const program = require('commander');
const { cliUtils } = require('@cumulus/common');
const { lambda } = require('@cumulus/common/aws');
const pckg = require('../package.json');
const es = require('./es');
const backup = require('./backup');
const restore = require('./restore');
const { serveApi, serveDistributionApi } = require('./serve');
const { defaultIndexAlias } = require('../es/search');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]');

program
  .command('reindex')
  .description('Reindex elasticsearch index to a new destination index')
  .option('-a, --index-alias <indexAlias>', 'AWS Elasticsearch index alias', defaultIndexAlias)
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source-index <sourceIndex>', 'Index to reindex', null)
  .option('-d, --dest-index <destIndex>',
    'Name of the destination index, should not be an existing index. Will default to an index named with today\'s date',
    null)
  .action((cmd) => {
    const missingOptions = cliUtils.findMissingOptions(cmd, ['host']);
    if (missingOptions.length === 0) {
      es.reindex(
        cmd.host,
        cmd.sourceIndex,
        cmd.destIndex,
        cmd.indexAlias
      ).then((response) => console.log(`Reindex successful: ${JSON.stringify(response)}`))
        .catch((err) => console.error(`Error reindexing: ${err.message}`));
    } else {
      cliUtils.displayMissingOptionsMessage(missingOptions);
    }
  });

program
  .command('status')
  .description('Get the status of the reindex tasks for the given host')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .action((cmd) => {
    const missingOptions = cliUtils.findMissingOptions(cmd, ['host']);
    if (missingOptions.length === 0) {
      es.getStatus(cmd.host)
        .then((tasks) => console.log(JSON.stringify(tasks)))
        .catch((err) => console.error(`Error getting status: ${err.message}`));
    } else {
      cliUtils.displayMissingOptionsMessage(missingOptions);
    }
  });

program
  .command('complete-reindex')
  .description('Switch to using the new index (destination index) instead of the source index.')
  .option('-a, --index-alias <indexAlias>', 'AWS Elasticsearch index alias', 'cumulus-alias')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source-index <sourceIndex>', 'Index to switch from and no longer used', null)
  .option('-d, --dest-index <destIndex>', 'Index to be aliased and used as the elasticsearch index for Cumulus', null)
  .action((cmd) => {
    const missingOptions = cliUtils.findMissingOptions(cmd, ['host']);
    if (missingOptions.length === 0) {
      es.completeReindex(
        cmd.host,
        cmd.sourceIndex,
        cmd.destIndex,
        cmd.indexAlias
      ).catch((err) => console.error(`Error: ${err.message}`));
    } else {
      cliUtils.displayMissingOptionsMessage(missingOptions);
    }
  });

program
  .command('migrate')
  .option('--stack <stack>', 'AWS CloudFormation stack name')
  .option('--migrationVersion <version>', 'Migration version to run')
  .description('Invokes the migration lambda function')
  .action((cmd) => {
    if (!cmd.migrationVersion) {
      throw new Error('version argument is missing');
    }
    if (!cmd.stack) {
      throw new Error('stack name is missing');
    }
    const l = lambda();
    console.log(`Invoking migration: ${cmd.migrationVersion}`);
    l.invoke({
      FunctionName: `${cmd.stack}-executeMigrations`,
      Payload: `{ "migrations": ["${cmd.migrationVersion}"] }`
    }).promise().then(console.log).catch(console.error);
  });

program
  .command('backup')
  .option('--table <table>', 'AWS DynamoDB table name')
  .option('--region <region>', 'AWS region name (default: us-east-1)')
  .option('--directory <directory>', 'The directory to save the backups to.'
    + ' Defaults to backups in the current directory')
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

    const concurrency = !cmd.concurrency ? 2 : parseInt(cmd.concurrency, 10);

    if (cmd.region) {
      process.env.AWS_DEFAULT_REGION = cmd.region;
    }

    restore(file, cmd.table, concurrency).then(console.log).catch(console.error);
  });

program
  .command('serve')
  .description('Serves the local version of the Cumulus API')
  .action(() => {
    serveApi(process.env.USERNAME).catch(console.error);
  });

program
  .command('serve-dist')
  .description('Serves the local version of the distribution API')
  .action(() => {
    serveDistributionApi(process.env.stackName).catch(console.error);
  });

program
  .parse(process.argv);

#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const pckg = require('../package.json');
const es = require('./es');
const program = require('commander');
const { cliUtils } = require('@cumulus/common');
const { lambda } = require('@cumulus/common/aws');
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
    'Name of the destination index, should not be an existing index. Will default to an index named with today\'s date', // eslint-disable-line max-len
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
    }
    else {
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
      es.getStatus(cmd.host).then((tasks) => console.log(JSON.stringify(tasks)));
    }
    else {
      cliUtils.displayMissingOptionsMessage(missingOptions);
    }
  });

program
  .command('complete-reindex')
  .description('Switch to using the new index (destination index) instead of the source index.')
  .option('-a, --index-alias <indexAlias>', 'AWS Elasticsearch index alias', 'cumulus-alias')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source-index <sourceIndex>', 'Index to switch from and no longer used', null)
  .option('-d, --dest-index <destIndex>', 'Index to be aliased and used as the elasticsearch index for Cumulus', null) // eslint-disable-line max-len
  .parse(process.argv)
  .action((cmd) => {
    const missingOptions = cliUtils.findMissingOptions(cmd, ['host']);
    if (missingOptions.length === 0) {
      es.completeReindex(
        cmd.host,
        cmd.sourceIndex,
        cmd.destIndex,
        cmd.indexAlias
      ).catch((err) => console.error(`Error: ${err.message}`));
    }
    else {
      cliUtils.displayMissingOptionsMessage(missingOptions);
    }
  });

program
  .command('migrate')
  .option('--stack <stack>', 'AWS CloudFormatio stack name')
  .description('Invokes the migration lambda function')
  .parse(process.argv)
  .action((cmd) => {
    if (!cmd.stack) {
      throw new Error('stack name is missing');
    }

    const l = lambda();
    l.invoke({
      FunctionName: `${cmd.stack}-executeMigrations`
    }).promise().then(console.log).catch(console.error);
  });

program
  .parse(process.argv);

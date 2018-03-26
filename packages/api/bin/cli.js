#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const pckg = require('../package.json');
const es = require('./es');
const program = require('commander');
const { cliUtils } = require('@cumulus/common');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]');

program
  .command('reindex')
  .description('Reindex elasticsearch index to a new destination index')
  .option('-a, --index-alias <aliasName>', 'AWS Elasticsearch index alias', null)
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source <sourceIndex>', 'Index to reindex', null)
  .option('-d, --dest-index <destIndex>',
    'Name of the destination index, should not be an existing index. Will default to an index named with today\'s date', // eslint-disable-line max-len
    null)
  .action((cmd) => {
    if (cliUtils.verifyRequiredParameters([{ name: 'host', value: cmd.host }])) {
      es.reindex(
        cmd.host,
        cmd.sourceIndex,
        cmd.destIndex,
        cmd.aliasName
      ).then((response) => console.log(`Reindex successful: ${JSON.stringify(response)}`))
        .catch((err) => console.err(`Error reindexing: ${err.message}`));
    }
  });

program
  .command('status')
  .description('Get the status of the reindex tasks for the given host')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .action((cmd) => {
    if (cliUtils.verifyRequiredParameters([{ name: 'host', value: cmd.host }])) {
      es.getStatus(cmd.host).then((tasks) => console.log(JSON.stringify(tasks)));
    }
  });

program
  .command('complete-reindex')
  .description('Switch to using the new index (destination index) instead of the source index.')
  .option('-a, --index-alias <alias>', 'AWS Elasticsearch index alias', 'cumulus-alias')
  .option('--host <host>', 'AWS Elasticsearch host', null)
  .option('-s, --source <sourceIndex>', 'Index to switch from and no longer used', null)
  .option('-d, --dest-index <destIndex>',
    // eslint-disable-next-line max-len
    'Index to be aliased and used as the elasticsearch index for Cumulus',
    null)
  .parse(process.argv)
  .action((cmd) => {
    if (cliUtils.verifyRequiredParameters([{ name: 'host', value: cmd.host }])) {
      es.completeReindex(
        cmd.host,
        cmd.sourceIndex,
        cmd.destIndex,
        cmd.alias
      ).catch((err) => console.err(`Error: ${err.message}`));
    }
  });

program
  .parse(process.argv);

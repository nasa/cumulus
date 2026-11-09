#!/usr/bin/env node
/* eslint-disable node/shebang */

'use strict';

const program = require('commander');
const pckg = require('../package.json');
const { serveApi, serveDistributionApi } = require('./serve');

program.version(pckg.version);

program
  .usage('TYPE COMMAND [options]');

program
  .command('serve')
  .option('--stackName <stackName>', 'stackname to serve (defaults to "localrun")', undefined)
  .option('--no-reseed', 'do not reseed data stores with new data on start.')
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

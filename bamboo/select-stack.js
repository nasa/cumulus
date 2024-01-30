/* eslint no-console: "off" */

'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.BRANCH;

  if (!branch) return cb('none');

  // Nightly cron job
  //if (process.env.TRAVIS_EVENT_TYPE === 'cron') return cb('cumulus-nightly');

  if (branch === 'master') return cb('cumulus-source');

  // uses github name
  const stacks = {
    'Charles Huang': 'ch-ci',
    'Edwin Fenollal': 'ef-ci',
    'Filip Graniczny': 'fg-ci',
    'Jenny Liu': 'jl-rds',
    jennyhliu: 'jl-rds',
    kkelly51: 'kk-int',
    'Katherine Kelly': 'kk-int',
    'Jennifer Tran': 'jtran-int',
    'Jonathan Kovarik': 'jk',
    etcart: 'ecarton-ci',
    ecarton: 'ecarton-ci',
    nasamoduyebo: 'mao-ci',
    'Nate Pauzenga': 'np-ci',
    'Naga Nages': 'nnaga-ci',
    vpnguye2: 'vkn-ci',
    'Roger Kwarteng': 'rkwarten-ci',
    'Paul Pilone': 'ppilone-ci',
  };

  return git('.').log({ '--max-count': '1' }, (e, r) => {
    const author = r.latest.author_name;

    console.error(`Selecting build stack based on author name: "${author}"`);

    if (author && stacks[author]) {
      return cb(stacks[author]);
    }
    return cb('cumulus-from-pr');
  });
}

determineIntegrationTestStackName(console.log);

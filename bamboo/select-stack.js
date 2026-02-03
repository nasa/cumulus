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
    'Bryan Wexler': 'bwexler-ci',
    'Chris Durbin': 'cdd-ci',
    'Curtis Banh': 'cbanh-ci',
    dhudelson: 'dh-ci',
    etcart: 'ecarton-ci',
    ecarton: 'ecarton-ci',
    'Filip Graniczny': 'fg-ci',
    'James Norton': 'jn-ci',
    'Jenny Liu': 'jl-rds',
    jennyhliu: 'jl-rds',
    'Jonathan Kovarik': 'jk',
    kkelly51: 'kk-int',
    'Katherine Kelly': 'kk-int',
    'Mason Yates': 'mason-t-yates-ci',
    mckadesorensen: 'dms-opex-sbx-ci',
    mikedorfman: 'mikedorfman-ci',
    'Nate Pauzenga': 'np-ci',
    'Naga Nages': 'nnaga-ci',
    'Paul Pilone': 'ppilone-ci',
    'Robert Swanson': 'rs-ci',
    'Tim Clark': 'teclark-ci',
    wisdomaj: 'awisdom-ci',
    'Yonggang Liu': 'yliu10-ci',
  };

  return git('.').log({ '--max-count': '2' }, (e, r) => {
    const latestAuthor = r.latest.author_name;
    const secondLatestAuthor = r.all[1].author_name;
    const author = (latestAuthor && latestAuthor.startsWith('pre-commit-ci')) ? secondLatestAuthor : latestAuthor;

    console.error(`Selecting build stack based on author name: "${author}"`);

    if (author && stacks[author]) {
      return cb(stacks[author]);
    }
    return cb('cumulus-from-pr');
  });
}

determineIntegrationTestStackName(console.log);

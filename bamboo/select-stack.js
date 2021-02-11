/* eslint no-console: "off" */

'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.BRANCH;

  if (!branch) return cb('none');

  // Nightly cron job
  //if (process.env.TRAVIS_EVENT_TYPE === 'cron') return cb('cumulus-nightly');

  if (branch === 'master') return cb('cumulus-source');

  const stacks = {
    'Brian Tennity': 'bt-ci',
    'Danielle Peters': 'dop-ci',
    'Jennifer Tran': 'jtran-int',
    'Jenny Liu': 'jl',
    'Jonathan Kovarik': 'jk',
    'Katherine Kelly': 'kk-int',
    'Lauren Frederick': 'lf-test',
    'Mark Boyd': 'mboyd-int',
    'Matt Savoie': 'mhs',
    'Menno Van Diermen': 'mvd',
    'Nate Pauzenga': 'np-ci',
    jennyhliu: 'jl',
    kkelly51: 'kk-int',
    laurenfrederick: 'lf-test',
    Menno: 'mvd',
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

'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.TRAVIS_PULL_REQUEST_BRANCH || process.env.TRAVIS_BRANCH;

  if (!branch) return cb('none');

  // Nightly cron job
  if (process.env.TRAVIS_EVENT_TYPE == 'cron') return cb('cumulus-nightly');

  if (branch === 'master') return cb('cumulus-from-source');

  const stacks = {
    'Aimee Barciauskas': 'aimee-test',
    scisco: 'aj',
    'Jenny Liu': 'jl',
    jennyhliu: 'jl',
    kkelly51: 'kk-uat-deployment',
    'Lauren Frederick': 'lf',
    laurenfrederick: 'lf',
    'Mark Boyd': 'mboyd-int',
    yjpa7145: 'mth-2',
    'Matt Savoie': 'mhs',
    'Jonathan Kovarik': 'jk',
    'Menno Van Diermen': 'mvd',
    ifestus: 'jc'
  };

  return git('.').log({ '--max-count': '1' }, (e, r) => {
    const author = r.latest.author_name;
    if (author && stacks[author]) {
      return cb(stacks[author]);
    }
    return cb('cumulus-from-pr');
  });
}

determineIntegrationTestStackName((r) => console.log(r));

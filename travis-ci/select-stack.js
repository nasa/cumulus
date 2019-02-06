/* eslint no-console: "off" */

'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.TRAVIS_PULL_REQUEST_BRANCH || process.env.TRAVIS_BRANCH;

  if (!branch) return cb('none');

  // Nightly cron job
  if (process.env.TRAVIS_EVENT_TYPE === 'cron') return cb('cumulus-nightly');

  if (branch === 'master') return cb('cumulus-from-source');

  const stacks = {
    'Aimee Barciauskas': 'aimee-test',
    Alireza: 'aj',
    'Jenny Liu': 'jl',
    jennyhliu: 'jl',
    kkelly51: 'kk-uat-deployment',
    'Lauren Frederick': 'lf-int-test',
    laurenfrederick: 'lf-int-test',
    'Mark Boyd': 'mboyd-int',
    Marc: 'mth',
    yjpa7145: 'mth',
    mhuffnagle: 'mth',
    'Marc Huffnagle': 'mth',
    'Matt Savoie': 'mhs',
    'Jonathan Kovarik': 'jk',
    'Menno Van Diermen': 'mvd',
    'Jacob Campbell': 'jc'
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

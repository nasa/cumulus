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
    'Aimee Barciauskas': 'aimee',
    'Jenny Liu': 'jl',
    jennyhliu: 'jl',
    kkelly51: 'kk',
    'Lauren Frederick': 'lf-test',
    laurenfrederick: 'lf-test',
    'Mark Boyd': 'mboyd-int',
    Marc: 'mth',
    yjpa7145: 'mth',
    mhuffnagle: 'mth',
    'Marc Huffnagle': 'mth',
    'Matt Savoie': 'mhs',
    'Jonathan Kovarik': 'jk',
    'Menno Van Diermen': 'mvd',
    'Jacob Campbell': 'jc',
    ifestus: 'jc',
    'Chuck Daniels': 'chuckulus-ci',
    'Brian Tennity': 'bt-tf'
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

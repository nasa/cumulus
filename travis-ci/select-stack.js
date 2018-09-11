'use strict';

const git = require('simple-git');

function determineIntegrationTestStackName(cb) {
  const branch = process.env.TRAVIS_PULL_REQUEST_BRANCH || process.env.TRAVIS_BRANCH;

  if (!branch) return cb('none');

  if (branch === 'master') return cb('cumulus-from-source');

  const stacks = {
    'abarciauskas-bgse': 'aimee-test',
    scisco: 'aj',
    jennyhliu: 'jl',
    kkelly51: 'kk-uat-deployment',
    'Lauren Frederick': 'lf',
    laurenfrederick: 'lf',
    yjpa7145: 'mth-2',
    'Matt Savoie': 'mhs',
    Jkovarik: 'jk',
    'Menno Van Diermen': 'mvd',
    ifestus: 'jc'
  };

  return git('.').log({ '--max-count': '1'}, (e, r) => {
    const author = r.latest.author_name;
    if (author && stacks[author]) {
      return cb(stacks[author])
    }
    return cb('cumulus-from-pr');
  });
}

determineIntegrationTestStackName((r) => console.log(r));

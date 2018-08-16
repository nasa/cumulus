'use strict';

function determineIntegrationTestStackName() {
  const branch = process.env.TRAVIS_PULL_REQUEST_BRANCH || process.env.TRAVIS_BRANCH;

  if (!branch) return 'none';

  if (branch === 'master') return 'cumulus-from-source';

  const stacks = [
    'aimee',
    'aj',
    'jl',
    'kk-uat-deployment',
    'lf',
    'mth-2',
    'mhs', 
    'jk', 
    'mvd', 
    'jc'
  ];

  for (let ctr = 0; ctr < stacks.length; ctr += 1) {
    if (branch.endsWith(`-${stacks[ctr]}`)) return stacks[ctr];
  }

  return 'cumulus-from-pr';
}

console.log(determineIntegrationTestStackName());

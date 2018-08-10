'use strict';

function determineIntegrationTestStackName(branch) {
  if (!branch) return 'none';

  if (branch === 'master') return 'cumulus-from-source';
  if (branch.startsWith('release-')) return 'cumulus-from-source';

  if (branch.endsWith('-aimee')) return 'aimee';
  if (branch.endsWith('-aj')) return 'aj';
  if (branch.endsWith('-kk-uat-deployment')) return 'kk-uat-deployment';
  if (branch.endsWith('-mth-2')) return 'mth-2';
  if (branch.endsWith('-jl')) return 'jl';
  if (branch.endsWith('-lf')) return 'lf';

  return 'none';
}

console.log(determineIntegrationTestStackName(process.env.TRAVIS_BRANCH));

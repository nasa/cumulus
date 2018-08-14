/* eslint no-console: "off" */

'use strict';

const fs = require('fs-extra');
const getLatestVersion = require('latest-version');
const semver = require('semver');

// Given a git tag (process.env.TRAVIS_TAG), this function determines what NPM
// tag to apply to a new release.  More simply, this determines if the NPM tag
// should be "latest", or just the value of the git tag.
//
// - If the git tag does not begin with the letter "v" followed by a number then
//   this is not a new "latest" release and the git tag is returned.
//
// - If the version specified in lerna.json is a pre-release version then this
//   is not a new "latest" release and the git tag is returned.
//
// - If the version specified in lerna.json is not greater than the version
//   already tagged "latest" in NPM then this is not a new "latest" release and
//   the git tag is returned.
//
// - If the version specified in lerna.json is greater than the version already
//   tagged "latest" in NPM then this is a new "latest" release, and "latest" is
//   returned.
async function getNpmTag() {
  const thisTag = process.env.TRAVIS_TAG;
  if (!thisTag) throw new Error('TRAVIS_TAG is not set');

  // Official release tags start with "v" so, if this tag does not start with
  // "v", then it is definitely not going to be "latest".
  if (thisTag.match(/^v(\d.*)/)) {
    const lernaConfig = JSON.parse(await fs.readFile('lerna.json', 'utf8'));
    const thisVersion = lernaConfig.version;

    // If this is a pre-release version, we'll use the given tag
    if (semver.prerelease(thisVersion) !== null) return thisTag;

    const latestVersion = await getLatestVersion('@cumulus/common', { version: 'latest' });
    return (semver.gt(thisVersion, latestVersion)) ? 'latest' : thisTag;
  }

  return thisTag;
}

getNpmTag()
  .then(console.log)
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });

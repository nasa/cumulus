/* eslint no-console: "off" */

'use strict';

const fs = require('fs-extra');
async function importGetLatestVersion() {
  const { default: getLatestVersion } = await import('latest-version');
  return getLatestVersion;
}
const semver = require('semver');

// Given a git tag (process.env.GIT_TAG), this function determines what NPM
// tag to apply to a new release.  More simply, this determines if the NPM tag
// should be "latest", or just the value of the git tag.  Tags other than
// "latest" will be prefixed with "release-", since NPM tags are not allowed to
// be valid semantic versions.
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
  const getLatestVersion = await importGetLatestVersion();
  const thisTag = process.env.GIT_TAG;
  if (!thisTag) throw new Error('Version is not set');

  const lernaConfig = JSON.parse(await fs.readFile('lerna.json', 'utf8'));
  const thisVersion = lernaConfig.version;

  const latestVersion = await getLatestVersion('@cumulus/common', { version: 'latest' });

  if (
    // tag starts with "v" and a digit
    thisTag.match(/^v(\d.*)/)
    // the version in lerna.json is not a pre-release version
    && !semver.prerelease(thisVersion)
    // the version in lerna.json is greater than the currently published "latest" version
    && semver.gt(thisVersion, latestVersion)
  ) return 'latest';

  return `release-${thisTag}`;
}

getNpmTag()
  .then(console.log)
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

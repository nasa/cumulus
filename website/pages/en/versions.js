/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const React = require('react');

const CompLibrary = require('../../core/CompLibrary');

const Container = CompLibrary.Container;

const CWD = process.cwd();

const siteConfig = require(`${CWD}/siteConfig.js`);
const versions = require(`${CWD}/versions.json`);

function Versions() {
  const latestVersion = versions[0];
  const repoUrl = `https://github.com/${siteConfig.organizationName}/${
    siteConfig.projectName
  }`;
  const homePageDocId = 'cumulus-docs-readme';
  const unreleased = `${repoUrl}/blob/master/CHANGELOG.md#unreleased`;

  const releaseUrl = (version) => {
    return `${repoUrl}/releases/tag/${version}`;
  };

  const verUrl = (version, docId) => {
    return version ? `docs/${version}/${docId}` : `docs/${docId}`;
  };

  return (
    <div className="docMainWrapper wrapper">
      <Container className="mainContainer versionsContainer">
        <div className="post">
          <header className="postHeader">
            <h1>Cumulus Versions</h1>
          </header>
          <p>The versions on this page correspond directly to release versions in <a href="https://www.npmjs.com/org/cumulus">npm</a> and <a href="https://github.com/nasa/cumulus/releases">GitHub</a>.</p>
          <h3 id="latest">Current version (Stable)</h3>
          <table className="versions">
            <tbody>
              <tr>
                <th>{latestVersion}</th>
                <td>
                  <a href={verUrl('', homePageDocId)}>Documentation</a>
                </td>
                <td>
                  <a href={releaseUrl(latestVersion)}>Release Notes</a>
                </td>
              </tr>
            </tbody>
          </table>
          <h3 id="rc">Pre-release versions</h3>
          <table className="versions">
            <tbody>
              <tr>
                <th>master</th>
                <td>
                  <a href={verUrl('next', homePageDocId)}>Documentation</a>
                </td>
                <td>
                  <a href={unreleased}>Release Notes</a>
                </td>
              </tr>
            </tbody>
          </table>
          <h3 id="archive">Past Versions</h3>
          <table className="versions">
            <tbody>
              {versions.map(
                version =>
                  version !== latestVersion && (
                    <tr>
                      <th>{version}</th>
                      <td>
                        <a href={verUrl(version, homePageDocId)}>Documentation</a>
                      </td>
                      <td>
                        <a href={releaseUrl(version)}>Release Notes</a>
                      </td>
                    </tr>
                  )
              )}
            </tbody>
          </table>
          <p>
            You can find past versions of this project on{' '}
            <a href={repoUrl}>GitHub</a>.
          </p>
        </div>
      </Container>
    </div>
  );
}

module.exports = Versions;

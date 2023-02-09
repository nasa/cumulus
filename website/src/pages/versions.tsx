/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'; 
import {
  useVersions,
  useLatestVersion,
  // @ts-ignore
} from '@docusaurus/plugin-content-docs/client';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const docsPluginId = undefined; // Default docs plugin instance

export default function Versions(): JSX.Element {
  const {
    siteConfig: { organizationName, projectName },
  } = useDocusaurusContext();
  const versions = useVersions(docsPluginId);
  const latestVersion = useLatestVersion(docsPluginId);
  const pastVersions = versions.filter(
    (version) => version !== latestVersion && version.name !== 'current',
  );
  const repoUrl = `https://github.com/${organizationName}/${projectName}`;
  const homePageDocId = 'cumulus-docs-readme';
  const unreleased = `${repoUrl}/blob/master/CHANGELOG.md#unreleased`;

  const releaseUrl = (version: string) => {
    return `${repoUrl}/releases/tag/${version}`;
  };

  const verUrl = (version: string, docId: string) => {
    return version ? `docs/${version}/${docId}` : `docs/${docId}`;
  };

  return (
    <Layout title="Versions" description="Cumulus Versions">
      <main className="container margin-vert--lg">
        <Heading as="h1">
            <h1>Cumulus Versions</h1>
        </Heading>
        <div className="margin-bottom--lg">
          <p>The versions on this page correspond directly to release versions in <a href="https://www.npmjs.com/org/cumulus">npm</a> and <a href="https://github.com/nasa/cumulus/releases">GitHub</a>.</p>
          <h3 id="latest">Current version (Stable)</h3>
          <table className="versions">
            <tbody>
              <tr>
                <th>{latestVersion.label}</th>
                <td>
                  <a href={verUrl('', homePageDocId)}>Documentation</a>
                </td>
                <td>
                  <a href={releaseUrl(latestVersion.label)}>Release Notes</a>
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
              {pastVersions.map(
                version =>
                  version !== latestVersion && (
                    <tr>
                      <th>{version.label}</th>
                      <td>
                        <a href={verUrl(version.label, homePageDocId)}>Documentation</a>
                      </td>
                      <td>
                        <a href={releaseUrl(version.label)}>Release Notes</a>
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
      </main>
    </Layout>
  );
}


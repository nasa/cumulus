// eslint-disable-next-line node/no-unpublished-require
const React = require('react');
const docusaurusRouter = require('@docusaurus/router');
const defaultNavbarItemModule = require('@theme/NavbarItem/DefaultNavbarItem');
const versions = require('../../versions.json');

const useLocation = docusaurusRouter.useLocation;
const DefaultNavbarItem = defaultNavbarItemModule.default || defaultNavbarItemModule;
const CURRENT_STABLE_VERSION = versions[0];

const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+$/;

/**
 * Normalize a version string by removing an optional v-prefix.
 *
 * @param {string} version
 * @returns {string}
 */
function normalizeVersion(version) {
  return version.startsWith('v') ? version.slice(1) : version;
}

/**
 * Compare two semantic versions.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareSemver(left, right) {
  const [leftMajor, leftMinor, leftPatch] = normalizeVersion(left).split('.').map(Number);
  const [rightMajor, rightMinor, rightPatch] = normalizeVersion(right).split('.').map(Number);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
}

/**
 * Extract active docs version from the current pathname.
 *
 * @param {string} pathname
 * @returns {string|undefined}
 */
function getActiveDocsVersion(pathname) {
  const pathParts = pathname.split('/').filter(Boolean);
  const docsIndex = pathParts.indexOf('docs');

  if (docsIndex < 0) return undefined;

  const candidateVersion = pathParts[docsIndex + 1];

  if (!candidateVersion || candidateVersion === 'docs') return 'current';
  if (candidateVersion === 'next') return 'next';
  if (SEMVER_PATTERN.test(candidateVersion)) return candidateVersion;

  return 'current';
}

/**
 * Determine whether the navbar item should be rendered for the active version.
 *
 * @param {string|undefined} activeVersion
 * @param {string} minVersion
 * @returns {boolean}
 */
function shouldRenderForVersion(activeVersion, minVersion) {
  if (!activeVersion) return false;
  if (activeVersion === 'next') return true;

  const versionToCompare = activeVersion === 'current'
    ? CURRENT_STABLE_VERSION
    : activeVersion;

  return compareSemver(versionToCompare, minVersion) >= 0;
}

/**
 * Build a docs link for the active docs version.
 *
 * @param {string} activeVersion
 * @param {string} docPath
 * @returns {string}
 */
function getVersionedDocsPath(activeVersion, docPath) {
  if (activeVersion === 'next') return `/docs/next/${docPath}`;
  if (activeVersion === 'current') return `/docs/${docPath}`;
  return `/docs/${activeVersion}/${docPath}`;
}

/**
 * Render a navbar item only for docs versions that support the target doc path.
 *
 * @param {object} props
 * @returns {React.ReactNode|undefined}
 */
function VersionedNavbarItem(props) {
  const location = useLocation();
  const minVersion = props.minVersion;
  const docPath = props.docPath;
  // eslint-disable-next-line prefer-object-spread
  const navbarItemProps = Object.assign({}, props);

  delete navbarItemProps.minVersion;
  delete navbarItemProps.docPath;

  const activeVersion = getActiveDocsVersion(location.pathname);
  const shouldRender = shouldRenderForVersion(activeVersion, minVersion);

  if (!shouldRender) {
    return undefined;
  }

  // eslint-disable-next-line prefer-object-spread
  const finalNavbarItemProps = Object.assign({}, navbarItemProps, {
    to: getVersionedDocsPath(activeVersion, docPath),
  });

  return React.createElement(DefaultNavbarItem, finalNavbarItemProps);
}

module.exports = VersionedNavbarItem;

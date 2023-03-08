const versions = require('./versions.json');

function versionOptions() {
  const options = {};
  versions.map((version) => {
    options[version] = { banner: 'none' };
    return undefined;
  });
  return options;
}

module.exports = {
  title: 'Cumulus Documentation',
  tagline: 'This is a default tagline',
  url: 'https://nasa.github.io',
  baseUrl: '/cumulus/',
  organizationName: 'nasa',
  projectName: 'Cumulus',
  scripts: [
    'https://buttons.github.io/buttons.js',
  ],
  favicon: 'img/cumulus.ico',
  customFields: {},
  onBrokenLinks: 'log',
  onBrokenMarkdownLinks: 'log',
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
          path: '../docs',
          sidebarPath: require.resolve('./sidebars.js'),
          versions: versionOptions(),
        },
        blog: {},
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],
  plugins: [],
  themeConfig: {
    docs: {
      sidebar: {
        hideable: true,
      },
    },
    navbar: {
      hideOnScroll: true,
      style: 'primary',
      title: 'Cumulus Documentation',
      logo: {
        alt: '',
        src: 'img/ic_cumulus_logo_white.svg',
        srcDark: 'img/ic_cumulus_logo_white.svg',
        width: 32,
        height: 32,
      },
      items: [
        {
          href: 'https://nasa.github.io/cumulus-api',
          label: 'API Docs',
          position: 'left',
        },
        {
          href: 'https://nasa.github.io/cumulus-distribution-api',
          label: 'Distribution API Docs',
          position: 'left',
        },
        {
          type: 'doc',
          position: 'left',
          docId: 'cumulus-docs-readme',
          label: 'Developer Docs',
        },
        {
          type: 'doc',
          position: 'left',
          docId: 'data-cookbooks/about-cookbooks',
          label: 'Data Cookbooks',
        },
        {
          type: 'doc',
          position: 'left',
          docId: 'operator-docs/about-operator-docs',
          label: 'Operator Docs',
        },
        {
          type: 'docsVersionDropdown',
          position: 'right',
          dropdownActiveClassDisabled: true,
          dropdownItemsAfter: [
            {
              type: 'html',
              value: '<hr class="dropdown-separator">',
            },
            {
              to: '/versions',
              label: 'All versions',
            },
          ],
        },
        {
          href: 'https://github.com/nasa/cumulus',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    algolia: {
      appId: process.env.DOCSEARCH_API_ID || 'fakeApiId',
      apiKey: process.env.DOCSEARCH_API_KEY || 'fakeApiKey',
      indexName: process.env.DOCSEARCH_INDEX_NAME || 'fakeIndexName',
      searchParameters: {
        facetFilters: [
          'version:VERSION',
        ],
      },
    },
  },
};

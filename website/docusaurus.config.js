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
  favicon: 'img/cumulus-logo.png',
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
          sidebarPath: './sidebars.json',
        },
        blog: {},
        theme: {
          customCss: './src/css/customTheme.css',
        },
      },
    ],
  ],
  plugins: [],
  themeConfig: {
    navbar: {
      title: 'Cumulus Documentation',
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
          to: 'docs/cumulus-docs-readme',
          label: 'Developer Docs',
          position: 'left',
        },
        {
          to: 'docs/data-cookbooks/about-cookbooks',
          label: 'Data-Cookbooks',
          position: 'left',
        },
        {
          to: 'docs/operator-docs/about-operator-docs',
          label: 'Operator Docs',
          position: 'left',
        },
      ],
    },
    footer: {
      links: [],
      logo: {
        src: '/img/meta_opensource_logo_negative.svg',
      },
    },
    algolia: {
      appId: 'X1Z85QJPUV',
      apiKey: 'bf7211c161e8205da2f933a02534105a',
      indexName: 'docusaurus-2',
      algoliaOptions: {
        facetFilters: [
          'version:VERSION',
        ],
      },
    },
  },
};

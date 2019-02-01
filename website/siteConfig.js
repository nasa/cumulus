/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// See https://docusaurus.io/docs/site-config for all the possible
// site configuration options.

// List of projects/orgs using your project for the users page.
const users = [
  {
    //caption: 'User1',
    // You will need to prepend the image path with your baseUrl
    // if it is not '/', like: '/test-site/img/docusaurus.svg'.
    //image: '/img/docusaurus.svg',
    //infoLink: 'https://www.facebook.com',
    //pinned: true,
  }
];

const siteConfig = {
  title: 'Cumulus Documentation', // Title for your website.
  tagline: 'This is a default tagline',
  url: 'https://nasa.github.io', // Your website URL
  baseUrl: '/cumulus/', // Base URL for your project */
  // For github.io type URLs, you would set the url and baseUrl like:
  //   url: 'https://facebook.github.io',
  //   baseUrl: '/test-site/',

  // Used for publishing and more
  projectName: 'Cumulus',
  organizationName: 'nasa',
  // For top-level user or org sites, the organization is still the same.
  // e.g., for the https://JoelMarcey.github.io site, it would be set like...
  //   organizationName: 'JoelMarcey'

  // For no header links in the top nav bar -> headerLinks: [],
  headerLinks: [
    { doc: 'cumulus-docs-readme', label: 'Developer Docs' },
    { doc: 'data-cookbooks/about-cookbooks', label: 'Data-Cookbooks' },
    { doc: 'operator-docs/about-operator-docs', label: 'Operator Docs' },
    { href: 'https://nasa.github.io/cumulus-api', label: 'API Docs' },
    { doc: 'team', label: 'Team' },
    { search: true }
  ],

  algolia: {
    apiKey: process.env.DOCSEARCH_API_KEY,
    indexName: process.env.DOCSEARCH_INDEX_NAME
  },

  /* Colors for website */
  colors: {
    primaryColor: '#2276AC',
    secondaryColor: '#7AB5DA'
  },

  /* Custom fonts for website */
  /*
  fonts: {
    myFont: [
      "Times New Roman",
      "Serif"
    ],
    myOtherFont: [
      "-apple-system",
      "system-ui"
    ]
  },
  */

  // This copyright info is used in /core/Footer.js and blog RSS/Atom feeds.
  //copyright: `Copyright © ${new Date().getFullYear()} Your Name or Your Company Name`,

  highlight: {
    // Highlight.js theme to use for syntax highlighting in code blocks.
    theme: 'default'
  },

  // Add custom scripts here that would be placed in <script> tags.
  scripts: ['https://buttons.github.io/buttons.js'],

  // On page navigation for the current documentation page.
  onPageNav: 'separate',
  // No .html extensions for paths.
  cleanUrl: true

  // You may provide arbitrary config keys to be used as needed by your
  // template. For example, if you need your repo's URL...
  //   repoUrl: 'https://github.com/facebook/test-site',
};

module.exports = siteConfig;

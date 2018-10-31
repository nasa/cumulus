#!/usr/bin/env node

const fs = require('fs-extra');
const { get, set, forEach } = require('lodash');
const path = require('path');

const workingDir = process.env.PWD;
const siteConfigPathNoExt = path.join(
  workingDir,
  'website',
  'siteConfig'
);
const siteConfig = require(siteConfigPathNoExt);
const siteConfigPath = [siteConfigPathNoExt, 'js'].join('.');


/**
 * Replace DocSearch keys in siteConfig
 *
 * @param {string} apiKey - value to insert into algolia.apiKey
 * @param {string} indexName - value to insert into algolia.indexName
 * @returns {undefined}
 */
function replaceSiteConfigAlgoliaValues(apiKey, indexName) {
  const envStrings = { apiKey, indexName };

  const replaceValues = {
    apiKey: get(process.env, envStrings.apiKey),
    indexName: get(process.env, envStrings.indexName)
  };
    

  forEach(replaceValues, (value, key) => {
    if (value) {
      set(siteConfig, `algolia.${key}`, value);
    } else {
      process.exitCode = 1;
      throw new Error(`${get(envStrings, key)} must be set.`);
    }
  });
}


/**
 * Writes siteConfig.js to the website directory
 *
 * @returns {undefined}
 */
function writeSiteConfig() {
  fs.writeFile(
    siteConfigPath,
    JSON.stringify(siteConfig),
    {encoding: 'utf8'}
  );
  console.log(`Wrote DocSearch apiKey and indexName into ${siteConfigPath}`);
}


replaceSiteConfigAlgoliaValues('DOCSEARCH_API_KEY', 'DOCSEARCH_INDEX_NAME');
writeSiteConfig();

#!/usr/bin/env node

const fs = require('fs-extra');
const { get, set, forEach } = require('lodash');
const path = require('path');

workingDir = process.env.PWD;
const siteConfigPathNoExt = path.join(
  workingDir,
  'website',
  'siteConfig'
);

// require is relative to where the js file exists
const siteConfig = require(siteConfigPathNoExt);

function replaceDocSearchApiKey() {
  const envStrings = {
    apiKey: 'DOCSEARCH_API_KEY',
    indexName: 'DOCSEARCH_INDEX_NAME'
  };

  const apiKey = get(process.env, envStrings.apiKey);
  const indexName = get(process.env, envStrings.indexName);

  const replaceValues = { apiKey, indexName };
    

  forEach(replaceValues, (value, key) => {
    if (value) {
      set(siteConfig.algolia, key, value);
    } else {
      throw new Error(`${get(envStrings, key)} must be set.`);
    }
  });
}

function writeSiteConfig() {
  const siteConfigPath = [siteConfigPathNoExt, 'js'].join('.');
  fs.writeFile(
    siteConfigPath,
    JSON.stringify(siteConfig),
    {encoding: 'utf8'}
  );
  console.log(`Wrote DocSearch apiKey and indexName into ${siteConfigPath}`);
}

replaceDocSearchApiKey();
writeSiteConfig();

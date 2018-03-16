'use strict';

/* eslint-disable no-console */
/* eslint-disable no-param-reassign */

const { Search, defaultIndexAlias } = require('../es/search');
const mappings = require('../models/mappings.json');

async function completeReindex(host, sourceIndex, destIndex, aliasName = defaultIndexAlias, deleteSource = false) {
  const esClient = await Search.es(host);

  const idx = await esClient.indices.get({ index: aliasName });

  console.log(JSON.stringify(idx));
}

async function getStatus(host) {
  const esClient = await Search.es(host);

  const tasks = await esClient.tasks.list();

  console.log(JSON.stringify(tasks));
}

async function reindex(host, sourceIndex = 'cumulus', destIndex = null, aliasName = defaultIndexAlias) {
  const esClient = await Search.es(host);

  const aliasExists = await esClient.indices.existsAlias({
    name: aliasName
  });

  if (!aliasExists) {
    // eslint-disable-next-line max-len
    throw new Error(`Alias ${aliasName} does not exist. Before re-indexing, re-deploy your instance of Cumulus.`);
  }

  const alias = await esClient.indices.getAlias({
    name: aliasName
  });

  // alias keys = index name
  const indices = Object.keys(alias);
  if (indices.length > 1) {
    // We don't know which index to use as the source, throw error
    // eslint-disable-next-line max-len
    throw new Error(`Multiple indices found for alias ${aliasName}. Specify source index as one of [${indices.join(', ')}].`);
  }

  if (sourceIndex === null) {
    sourceIndex = indices[0];
  }
  else {
    const sourceExists = await esClient.indices.exists({ index: sourceIndex });

    if (!sourceExists) {
      throw new Error(`Source index ${sourceIndex} does not exist.`);
    }

    if (indices.includes(sourceIndex) === false) {
      throw new Error(`Source index ${sourceIndex} is not aliased with alias ${aliasName}.`);
    }
  }

  if (destIndex === null) {
    const date = new Date();
    destIndex = `cumulus-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  const destExists = await esClient.indices.exists({ index: destIndex });

  if (destExists) {
    // TO DO: throw error
  }
  else {
    // create destination index
    const indexResponse = await esClient.indices.create({
      index: destIndex,
      body: { mappings }
    });

    console.log(`Created destination index ${destIndex}.`);
  }

  // reindex
  const reindexResponse = await esClient.reindex({
    body: {
      source: { index: sourceIndex },
      dest: { index: destIndex }
    }
  });

  console.log(JSON.stringify(reindexResponse));
}

module.exports.reindex = reindex;
module.exports.getStatus = getStatus;
module.exports.completeReindex = completeReindex;

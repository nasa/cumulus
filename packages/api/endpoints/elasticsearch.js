'use strict';

const router = require('express-promise-router')();

const log = require('@cumulus/common/log');

const mappings = require('../models/mappings.json');
const { defaultIndexAlias, Search } = require('../es/search');

const snapshotRepoName = 'cumulus-es-snapshots';

async function createEsSnapshot(req, res) {
  const esClient = await Search.es();

  //let repository = null;

  try {
    const repository = await esClient.snapshot.getRepository({ repository: snapshotRepoName });
  }
  catch (err) {
    // Handle repository missing exceptions
    if (!err.message.includes('[repository_missing_exception]')) {
      throw err;
    }

    // TO DO: when permission boundaries are updated
    // repository = await esClient.snapshot.createRepository({
    //   repository: snapshotRepoName,
    //   verify: false,
    //   body: {
    //     type: 's3',
    //     settings: {
    //       bucket: 'lf-internal',
    //       region: 'us-east-1',
    //       role_arn: process.env.ROLE_ARN
    //     }
    //   }
    // });
  }

  return res.boom.badRequest('done');
}

async function reindex(req, res) {
  let sourceIndex = req.body.sourceIndex;
  let destIndex = req.body.destIndex;
  let aliasName = req.body.aliasName || defaultIndexAlias;

  const esClient = await Search.es();

  const alias = await esClient.indices.getAlias({
    name: aliasName
  });

  // alias keys = index name
  const indices = Object.keys(alias);

  if (!sourceIndex) {
    if (indices.length > 1) {
      // We don't know which index to use as the source, throw error
      return res.boom.badRequest(`Multiple indices found for alias ${aliasName}. Specify source index as one of [${indices.sort().join(', ')}].`);
    }

    sourceIndex = indices[0];
  }
  else {
    const sourceExists = await esClient.indices.exists({ index: sourceIndex });

    if (!sourceExists) {
      return res.boom.badRequest(`Source index ${sourceIndex} does not exist.`);
    }

    if (indices.includes(sourceIndex) === false) {
      return res.boom.badRequest(`Source index ${sourceIndex} is not aliased with alias ${aliasName}.`);
    }
  }

  if (destIndex === null) {
    const date = new Date();
    destIndex = `cumulus-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  const destExists = await esClient.indices.exists({ index: destIndex });

  if (destExists) {
    return res.boom.badRequest(`Destination index ${destIndex} exists. Please specify an index name that does not exist.`);
  }
  else {
    // create destination index
    await esClient.indices.create({
      index: destIndex,
      body: { mappings }
    });

    log.info(`Created destination index ${destIndex}.`);
  }

  // reindex
  const response = await esClient.reindex({
    body: {
      source: { index: sourceIndex },
      dest: { index: destIndex }
    }
  });

  return res.status(200).send(response);
}

async function reindexStatus(req, res) {
  return res.send('To do: implement reindex status');
}

async function completeReindex(req, res) {
  return res.send('To do: implement create reindex');
}

// express routes
router.put('/create-snapshot', createEsSnapshot);
router.put('/reindex', reindex);
router.put('/reindex-status', reindexStatus);
router.put('/complete-reindex', completeReindex);

module.exports = router;
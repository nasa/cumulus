'use strict';

const router = require('express-promise-router')();
const {
  aws
} = require('@cumulus/common');

/*
 * To Do: Took this from dist, move to common
 */
function getFileBucketAndKey(pathParams) {
  const fields = pathParams.split('/');

  const Bucket = fields.shift();
  const Key = fields.join('/');

  if (Bucket.length === 0 || Key.length === 0) {
    throw new Error(pathParams);
  }

  return [Bucket, Key];
}


/**
 * TO DO
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const params = getFileBucketAndKey(req.params[0]);

  const getObjectResponse = await aws.getS3Object(params[0], params[1]);
  res.set('Content-Type', getObjectResponse.ContentType);
  return res.send(getObjectResponse.Body.toString());
}

router.get('/*', get);

module.exports = router;

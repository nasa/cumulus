'use strict';

const get = require('lodash/get');
const router = require('express-promise-router')();
const { getFileBucketAndKey } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

/**
 * Given a path in the form of bucket/key, get the item from
 * S3 and return it with the corret content type. This is used to server
 * the dashboard from the specified bucket
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleGetRequest(req, res) {
  const [Bucket, Key] = getFileBucketAndKey(req.params[0]);
  try {
    const response = await s3().getObject({ Bucket, Key });
    res.set('Content-Type', get(response, 'Body.headers.content-type'));
    return response.Body.pipe(res);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.name === 'NoSuchBucket') {
      return res.boom.notFound(`file ${req.params[0]} does not exist!`);
    }
    throw error;
  }
}

router.get('/*', handleGetRequest);

module.exports = router;

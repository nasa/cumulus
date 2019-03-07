'use strict';

const router = require('express-promise-router')();
const {
  getS3Object,
  getFileBucketAndKey
} = require('@cumulus/common/aws');

/**
 * Given a path in the form of bucket/key, get the item from
 * S3 and return it with the corret content type. This is used to server
 * the dashboard from the specified bucket
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const [bucket, key] = getFileBucketAndKey(req.params[0]);

  const getObjectResponse = await getS3Object(bucket, key);
  res.set('Content-Type', getObjectResponse.ContentType);
  return res.send(getObjectResponse.Body.toString());
}

router.get('/*', get);

module.exports = router;

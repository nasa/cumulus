'use strict';

const router = require('express-promise-router')();
const {
  s3,
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
  const [Bucket, Key] = getFileBucketAndKey(req.params[0]);

  return s3().getObject({ Bucket, Key })
    .on('httpHeaders', (code, headers) => {
      res.set('Content-Type', headers['content-type']);
    })
    .createReadStream()
    .pipe(res);
}

router.get('/*', get);

module.exports = router;

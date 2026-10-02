// @ts-check

'use strict';

const {
  getJsonS3Object,
  listS3ObjectsV2,
  putJsonS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');

/**
 * Load records live in S3, not in the target database, so a load leaves nothing in the
 * database except the seeded Cumulus rows. Some targets (CC SIT, with pglogical) refuse
 * every DROP and TRUNCATE for the Cumulus user, so a bookkeeping table could never be
 * removed there.
 *
 * A record holds the target ids a load inserted, which is everything revert needs.
 */

/**
 * @param {object} params
 * @param {string} params.prefix
 * @param {string} [params.loadId]
 * @returns {string}
 */
const recordKey = ({ prefix, loadId }) =>
  `${prefix}/granule-seed/loads/${loadId ? `${loadId}.json` : ''}`;

/**
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @param {object} params.record - must carry `loadId`
 * @returns {Promise<void>}
 */
const writeRecord = async ({ bucket, prefix, record }) => {
  await putJsonS3Object(bucket, recordKey({ prefix, loadId: record.loadId }), record);
};

/**
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @param {string} params.loadId
 * @returns {Promise<any>}
 */
const readRecord = async ({ bucket, prefix, loadId }) => {
  const key = recordKey({ prefix, loadId });
  if (!(await s3ObjectExists({ Bucket: bucket, Key: key }))) {
    throw new Error(`No load record at s3://${bucket}/${key}`);
  }
  return getJsonS3Object(bucket, key, false);
};

/**
 * Summaries of every recorded load, newest first. The id lists are left out.
 *
 * @param {object} params
 * @param {string} params.bucket
 * @param {string} params.prefix
 * @returns {Promise<object[]>}
 */
const listRecords = async ({ bucket, prefix }) => {
  const objects = await listS3ObjectsV2(
    { Bucket: bucket, Prefix: recordKey({ prefix }) },
    false
  );
  const records = await Promise.all(
    (objects ?? [])
      .filter((object) => object.Key?.endsWith('.json'))
      .map((object) => getJsonS3Object(bucket, /** @type {string} */ (object.Key), false))
  );
  return records
    .map(({ ids: _ids, ...summary }) => summary)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
};

module.exports = { listRecords, readRecord, recordKey, writeRecord };

// @ts-check

'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { PassThrough, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const { to: copyTo, from: copyFrom } = require('pg-copy-streams');
const { streamS3Upload, getObjectReadStream } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const GZIP_LEVEL = 9;

/**
 * A pass-through that accumulates a byte count and a running sha256.
 *
 * Both are measured over the *uncompressed* CSV so that a checksum recorded by the
 * extractor can be reproduced by anything that can read the table, independent of the
 * gzip implementation or compression level.
 */
class Digester extends Transform {
  constructor() {
    super();
    this.bytes = 0;
    // Newlines seen, which over-counts rows when a text field contains one; the exact row
    // count comes from the server when the COPY completes. Good enough for progress.
    this.lines = 0;
    this.hash = crypto.createHash('sha256');
  }

  /**
   * @param {Buffer} chunk
   * @param {string} _encoding
   * @param {(error?: Error | null) => void} callback
   */
  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, i + 1)) this.lines += 1;
    this.hash.update(chunk);
    this.push(chunk);
    callback();
  }

  digest() {
    return this.hash.digest('hex');
  }
}

/**
 * Build the COPY statement used for every extraction.
 *
 * HEADER is always on so that the loader can assert the bundle's column order against
 * the manifest rather than trusting positional alignment.
 *
 * @param {string} innerSql - a SELECT, without a trailing semicolon
 * @returns {string}
 */
const copyOutStatement = (innerSql) =>
  `COPY (${innerSql}) TO STDOUT WITH (FORMAT csv, HEADER true)`;

/**
 * Build the COPY statement used to load a staging table.
 *
 * @param {string} table - already-quoted or safe identifier
 * @param {string[]} columns
 * @returns {string}
 */
const copyInStatement = (table, columns) => {
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  return `COPY ${table} (${columnList}) FROM STDIN WITH (FORMAT csv, HEADER true)`;
};

/**
 * Stream the result of a query to a gzipped S3 object.
 *
 * `rowCount` comes from the server's `COPY n` CommandComplete message, not from counting
 * newlines — CSV fields legitimately contain newlines (jsonb `error` payloads do), so
 * newline counting reports the wrong number.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.sql - a SELECT, without a trailing semicolon
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {(progress: {bytes: number, lines: number, seconds: number}) => void} [params.onProgress]
 *   called every `progressIntervalMs` while the COPY streams
 * @param {number} [params.progressIntervalMs]
 * @returns {Promise<{rowCount: number, uncompressedBytes: number, sha256: string}>}
 */
const copyQueryToGzipS3 = async ({
  client, sql, bucket, key, onProgress, progressIntervalMs = 60_000,
}) => {
  const copyStream = client.query(copyTo(copyOutStatement(sql)));
  const digester = new Digester();
  const started = Date.now();
  const timer = onProgress && setInterval(() => onProgress({
    bytes: digester.bytes,
    lines: digester.lines,
    seconds: Math.round((Date.now() - started) / 1000),
  }), progressIntervalMs);
  const gzip = zlib.createGzip({ level: GZIP_LEVEL });

  // Start the upload before the pipeline so gzip's readable side is being consumed while
  // it is written to; otherwise the pipeline stalls once gzip's buffer fills.
  const uploadPromise = streamS3Upload(gzip, {
    params: { Bucket: bucket, Key: key },
  });

  try {
    await pipeline(copyStream, digester, gzip);
    await uploadPromise;
  } finally {
    if (timer) clearInterval(timer);
  }

  return {
    rowCount: copyStream.rowCount,
    uncompressedBytes: digester.bytes,
    sha256: digester.digest(),
  };
};

/**
 * Stream the result of a query to an in-memory buffer. Used by tests and by `--dry-run`
 * inspection of the small dimension tables; never for granules or files.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.sql
 * @returns {Promise<{csv: string, rowCount: number}>}
 */
const copyQueryToString = async ({ client, sql }) => {
  const copyStream = client.query(copyTo(copyOutStatement(sql)));
  const sink = new PassThrough();
  /** @type {Buffer[]} */
  const chunks = [];
  sink.on('data', (chunk) => chunks.push(chunk));

  await pipeline(copyStream, sink);

  return {
    csv: Buffer.concat(chunks).toString('utf8'),
    rowCount: copyStream.rowCount,
  };
};

/**
 * Stream a gzipped S3 object into a table via COPY.
 *
 * A server-side failure (a constraint violation, a guard-trigger 23505, a malformed
 * field) surfaces on the query rather than on the stream, so both are awaited.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {string} params.bucket
 * @param {string} params.key
 * @param {string} params.table
 * @param {string[]} params.columns
 * @returns {Promise<{rowCount: number}>}
 */
const copyGzipS3ToTable = async ({ client, bucket, key, table, columns }) => {
  const readStream = await getObjectReadStream({
    s3: s3(),
    bucket,
    key,
    requesterPays: false,
  });

  const gunzip = zlib.createGunzip();
  const copyStream = client.query(copyFrom(copyInStatement(table, columns)));

  await pipeline(readStream, gunzip, copyStream);

  return { rowCount: copyStream.rowCount };
};

module.exports = {
  Digester,
  copyGzipS3ToTable,
  copyInStatement,
  copyOutStatement,
  copyQueryToGzipS3,
  copyQueryToString,
};

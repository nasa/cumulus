'use strict';

const test = require('ava');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const { from: copyFrom } = require('pg-copy-streams');
const { Client } = require('pg');
const { randomId } = require('@cumulus/common/test-utils');
const { createBucket, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');

const {
  copyInStatement,
  copyOutStatement,
  copyQueryToGzipS3,
  copyQueryToString,
} = require('../src/copy');
const {
  createSeedTestDb,
  localClientConfig,
  teardownSeedTestDb,
} = require('./helpers/testDb');

test.before(async (t) => {
  t.timeout(300 * 1000);
  const testDbName = randomId('seedcopy').replace(/-/g, '_');
  Object.assign(t.context, await createSeedTestDb({ testDbName }));

  t.context.client = new Client(localClientConfig(testDbName));
  await t.context.client.connect();
});

test.after.always(async (t) => {
  if (t.context.client) await t.context.client.end();
  await teardownSeedTestDb(t.context);
});

test('copyOutStatement always requests CSV with a header', (t) => {
  t.is(
    copyOutStatement('SELECT 1'),
    'COPY (SELECT 1) TO STDOUT WITH (FORMAT csv, HEADER true)'
  );
});

test('copyInStatement quotes every column', (t) => {
  t.is(
    copyInStatement('stg_x', ['a', 'b c']),
    'COPY stg_x ("a", "b c") FROM STDIN WITH (FORMAT csv, HEADER true)'
  );
});

test.serial('rowCount comes from the server, not from counting newlines', async (t) => {
  const { client } = t.context;
  await client.query('DROP TABLE IF EXISTS nl_probe');
  await client.query('CREATE TABLE nl_probe (id int, message text, payload jsonb)');

  // A real newline inside a text column. Note that jsonb is *not* a hazard here: its text
  // output escapes newlines as a literal backslash-n, so jsonb never emits a bare newline
  // into CSV. Plain text columns do, and Cumulus has many of them.
  await client.query(
    `INSERT INTO nl_probe VALUES
       (1, E'line one\nline two\nline three', '{"e":"a\\nb"}'),
       (2, 'single line', '{"e":"plain"}')`
  );

  const { csv, rowCount } = await copyQueryToString({
    client,
    sql: 'SELECT * FROM nl_probe ORDER BY id',
  });

  t.is(rowCount, 2, 'server-reported row count');

  const newlines = csv.split('\n').length - 1;
  t.is(newlines, 5, 'header + 2 records, but 5 newlines because one field contains three');
  t.not(newlines, rowCount, 'counting newlines would report the wrong number of rows');

  await client.query('DROP TABLE nl_probe');
});

test.serial('a collection round-trips byte-identically through CSV', async (t) => {
  const { client } = t.context;

  // Deliberately awkward values: a jsonb payload containing a comma, a double quote, a
  // newline and non-ASCII text; and the NULL-versus-empty-string distinction, which any
  // hand-rolled CSV writer tends to collapse.
  const meta = {
    note: 'line1\nline2, with "quotes"',
    unicode: 'é中🛰',
    nested: { a: [1, 2, 3] },
  };

  await client.query(
    `INSERT INTO collections (
       name, version, sample_file_name, granule_id_extraction_regex,
       granule_id_validation_regex, files, meta, cmr_provider, metrics_provider,
       process, url_path, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())`,
    [
      'copy,test"collection', '001', 'file.txt', 'fake-regex', 'fake-regex',
      JSON.stringify([{ regex: 'r', sampleFileName: 'f.txt' }]),
      JSON.stringify(meta), 'cmr', 'metrics',
      null, '',
    ]
  );

  const columns = 'name, version, files, meta, process, url_path, metrics_provider';
  const { csv, rowCount } = await copyQueryToString({
    client,
    sql: `SELECT ${columns} FROM collections ORDER BY cumulus_id`,
  });
  t.is(rowCount, 1);

  // Load it straight back into a clone and compare in SQL, which is the only comparison
  // that proves jsonb and the NULL/'' distinction survived.
  await client.query('DROP TABLE IF EXISTS collections_clone');
  await client.query(`CREATE TABLE collections_clone AS
    SELECT ${columns} FROM collections WHERE false`);

  const inStream = client.query(copyFrom(
    copyInStatement('collections_clone', [
      'name', 'version', 'files', 'meta', 'process', 'url_path', 'metrics_provider',
    ])
  ));
  const source = new PassThrough();
  source.end(Buffer.from(csv, 'utf8'));
  await pipeline(source, inStream);

  t.is(inStream.rowCount, 1, 'one row loaded back');

  const { rows } = await client.query(
    `SELECT count(*)::int AS identical
       FROM collections a
       JOIN collections_clone b ON a.name = b.name AND a.version = b.version
      WHERE a.meta = b.meta
        AND a.files = b.files
        AND a.process IS NOT DISTINCT FROM b.process
        AND a.url_path IS NOT DISTINCT FROM b.url_path`
  );

  t.is(rows[0].identical, 1, 'jsonb, NULL and empty string all survived the round trip');

  const { rows: nullCheck } = await client.query(
    `SELECT process IS NULL AS process_null, url_path = '' AS url_path_empty
       FROM collections_clone`
  );
  t.true(nullCheck[0].process_null, 'NULL stayed NULL');
  t.true(nullCheck[0].url_path_empty, 'empty string stayed an empty string, not NULL');

  await client.query('DROP TABLE collections_clone');
});

test.serial('a text[] column round-trips, including an embedded comma', async (t) => {
  const { client } = t.context;

  await client.query(
    `INSERT INTO providers (name, protocol, host, allowed_redirects, created_at, updated_at)
     VALUES ($1, 'https', 'example.com', $2, now(), now())`,
    ['copy-array-provider', ['plain', 'has,comma', 'has"quote']]
  );

  const { csv } = await copyQueryToString({
    client,
    sql: `SELECT name, allowed_redirects FROM providers
           WHERE name = 'copy-array-provider'`,
  });

  await client.query('DROP TABLE IF EXISTS providers_clone');
  await client.query(`CREATE TABLE providers_clone AS
    SELECT name, allowed_redirects FROM providers WHERE false`);

  const inStream = client.query(
    copyFrom(copyInStatement('providers_clone', ['name', 'allowed_redirects']))
  );
  const source = new PassThrough();
  source.end(Buffer.from(csv, 'utf8'));
  await pipeline(source, inStream);

  const { rows } = await client.query(
    `SELECT b.allowed_redirects AS loaded
       FROM providers_clone b WHERE b.name = 'copy-array-provider'`
  );

  t.deepEqual(rows[0].loaded, ['plain', 'has,comma', 'has"quote']);

  await client.query('DROP TABLE providers_clone');
});

test.serial('a bigint near 2^53 survives as an exact value', async (t) => {
  const { client } = t.context;

  // product_volume is BIGINT. Reading it through knex would run it past
  // convertIdColumnsToNumber; COPY keeps it as text on the wire, which is the point.
  const big = '9007199254740993'; // 2^53 + 1, not representable as a JS number

  await client.query('DROP TABLE IF EXISTS bigint_probe');
  await client.query('CREATE TABLE bigint_probe (v bigint)');
  await client.query('INSERT INTO bigint_probe VALUES ($1)', [big]);

  const { csv } = await copyQueryToString({
    client,
    sql: 'SELECT v FROM bigint_probe',
  });

  t.true(csv.includes(big), `CSV should carry ${big} exactly, got: ${csv.trim()}`);

  await client.query('DROP TABLE bigint_probe');
});

test.serial('copyQueryToGzipS3 reports progress while it streams, then stops', async (t) => {
  const bucket = randomId('seed-progress').toLowerCase();
  await createBucket(bucket);
  try {
    const events = [];
    const result = await copyQueryToGzipS3({
      client: t.context.client,
      sql: 'SELECT g, pg_sleep(0.001) FROM generate_series(1, 400) g',
      bucket,
      key: 'progress.csv.gz',
      onProgress: (progress) => events.push(progress),
      progressIntervalMs: 50,
    });
    t.is(result.rowCount, 400);
    t.true(events.length > 0, 'at least one progress event during the COPY');
    t.true(events.every((e) => e.bytes >= 0 && e.lines >= 0 && e.seconds >= 0));

    const count = events.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    t.is(events.length, count, 'no progress events after the COPY finishes');
  } finally {
    await recursivelyDeleteS3Bucket(bucket);
  }
});

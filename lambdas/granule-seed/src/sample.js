// @ts-check

'use strict';

const noop = require('lodash/noop');

const SAMPLE_TABLE = 'seed_sample';

/**
 * @typedef {object} CollectionStat
 * @property {number} collectionCumulusId
 * @property {number} granuleCount
 */

/**
 * @typedef {object} CollectionAllocation
 * @property {number} collectionCumulusId
 * @property {number} granuleCount - how many granules to take from this collection
 */

/**
 * Above this many estimated granules, never fall back to an exact per-collection count.
 */
const EXACT_COUNT_LIMIT = 10_000_000;

/**
 * Estimate per-collection granule counts from planner statistics.
 *
 * For each hash partition of `granules`, multiply the partition's row estimate by the
 * frequency of each value in its `collection_cumulus_id` most-common-values list. This is
 * a catalog read — it touches no table data — which matters on a source with hundreds of
 * millions of granules, where even an index-only `GROUP BY` reads every index entry.
 *
 * Collections too rare to appear in any partition's statistics are absent from the
 * result and so are not sampled. Allocation only needs proportions, and the per-collection
 * `LIMIT` in `buildSampleTable` means an over-estimate can never over-sample.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<CollectionStat[]>}
 */
const estimateCollectionStats = async (client) => {
  const { rows } = await client.query(
    `WITH partitions AS (
       SELECT c.relname, greatest(c.reltuples, 0) AS tuples
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'granules'::regclass
     )
     SELECT u.value::int AS collection_cumulus_id,
            round(sum(u.freq * p.tuples))::bigint AS granule_count
       FROM partitions p
       JOIN pg_stats s
         ON s.schemaname = 'public'
        AND s.tablename = p.relname
        AND s.attname = 'collection_cumulus_id'
       CROSS JOIN LATERAL unnest(s.most_common_vals::text::int[], s.most_common_freqs)
         AS u(value, freq)
      GROUP BY u.value
     HAVING round(sum(u.freq * p.tuples)) > 0
      ORDER BY granule_count DESC, collection_cumulus_id`
  );

  return rows.map((row) => ({
    collectionCumulusId: Number(row.collection_cumulus_id),
    granuleCount: Number(row.granule_count),
  }));
};

/**
 * Per-collection granule counts: estimated from statistics where they exist, otherwise
 * counted exactly — but only on a small table. A source without statistics and with
 * millions of granules is refused rather than scanned.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<CollectionStat[]>}
 */
const getCollectionStats = async (client) => {
  const estimated = await estimateCollectionStats(client);
  if (estimated.length > 0) return estimated;

  const { rows: sizeRows } = await client.query(
    `SELECT coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint AS n
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'granules'::regclass`
  );
  if (Number(sizeRows[0].n) > EXACT_COUNT_LIMIT) {
    throw new Error(
      `granules has an estimated ${sizeRows[0].n} rows but no collection_cumulus_id `
        + 'statistics. Ask the database owner to ANALYZE granules; an exact per-collection '
        + 'count on a table that size would read every row.'
    );
  }

  const { rows } = await client.query(
    `SELECT collection_cumulus_id, count(*)::bigint AS granule_count
       FROM granules
      GROUP BY collection_cumulus_id
      ORDER BY granule_count DESC, collection_cumulus_id`
  );

  return rows.map((row) => ({
    collectionCumulusId: Number(row.collection_cumulus_id),
    granuleCount: Number(row.granule_count),
  }));
};

/**
 * @param {CollectionAllocation[]} allocations
 * @returns {number}
 */
const sumAllocations = (allocations) =>
  allocations.reduce((sum, a) => sum + a.granuleCount, 0);

/**
 * Raise allocations until they reach the budget, taking from the collections with the most
 * headroom first. Mutates `allocations`.
 *
 * @param {CollectionAllocation[]} allocations
 * @param {Map<number, number>} capacity - collection id -> granules available
 * @param {number} budget
 * @returns {void}
 */
const growToBudget = (allocations, capacity, budget) => {
  let assigned = sumAllocations(allocations);
  while (assigned < budget) {
    const candidate = allocations
      .filter((a) => a.granuleCount < (capacity.get(a.collectionCumulusId) ?? 0))
      .sort((a, b) => b.granuleCount - a.granuleCount)[0];
    if (!candidate) return;
    const headroom = (capacity.get(candidate.collectionCumulusId) ?? 0)
      - candidate.granuleCount;
    const grant = Math.min(headroom, budget - assigned);
    candidate.granuleCount += grant;
    assigned += grant;
  }
};

/**
 * Lower allocations until they fit the budget, one granule at a time from the largest
 * allocation, so the floor given to small collections is the last thing to go. Mutates
 * `allocations`.
 *
 * @param {CollectionAllocation[]} allocations
 * @param {number} budget
 * @returns {void}
 */
const shrinkToBudget = (allocations, budget) => {
  let assigned = sumAllocations(allocations);
  while (assigned > budget) {
    const largest = allocations.reduce((max, a) => (a.granuleCount > max.granuleCount ? a : max));
    const secondLargest = allocations
      .filter((a) => a !== largest)
      .reduce((max, a) => Math.max(max, a.granuleCount), 0);
    // Take the largest down to the next-largest in one step rather than one granule at a
    // time, which matters when a budget of 1M is being trimmed by thousands.
    const reduce = Math.max(1, Math.min(largest.granuleCount - secondLargest, assigned - budget));
    largest.granuleCount -= reduce;
    assigned -= reduce;
  }
};

/**
 * Apportion a granule budget across collections.
 *
 * Proportional to each collection's share, but with a floor so that small collections
 * still appear — a bundle that only contains the two biggest collections would not
 * exercise per-collection distribution, which is half the point of sampling real data.
 * When the budget is too small to give every collection the floor, only the largest
 * collections are sampled, one floor's worth each.
 *
 * @param {object} params
 * @param {number} params.budget - total granules wanted
 * @param {CollectionStat[]} params.collectionStats
 * @param {number} [params.floor] - minimum granules per collection, when available
 * @returns {{allocations: CollectionAllocation[], total: number}}
 */
const planAllocation = ({ budget, collectionStats, floor = 1 }) => {
  if (budget <= 0) throw new Error('budget must be positive');

  const nonEmpty = collectionStats.filter((stat) => stat.granuleCount > 0);
  if (nonEmpty.length === 0) {
    throw new Error('Source has no granules to sample');
  }

  // When the budget cannot give every collection the floor, sample the largest
  // collections. They are the representative ones, and on a big source they are also the
  // cheap ones to read: a rare collection's latest granules may sit behind millions of
  // other rows in its hash partition.
  const maxCollections = Math.max(1, Math.floor(budget / floor));
  const available = [...nonEmpty]
    .sort((x, y) => y.granuleCount - x.granuleCount
      || x.collectionCumulusId - y.collectionCumulusId)
    .slice(0, maxCollections);

  const totalAvailable = available.reduce((sum, stat) => sum + stat.granuleCount, 0);
  const effectiveBudget = Math.min(budget, totalAvailable);
  const capacity = new Map(available.map((s) => [s.collectionCumulusId, s.granuleCount]));

  /** @type {CollectionAllocation[]} */
  const allocations = available.map((stat) => ({
    collectionCumulusId: stat.collectionCumulusId,
    granuleCount: Math.min(
      stat.granuleCount,
      Math.max(floor, Math.floor((stat.granuleCount / totalAvailable) * effectiveBudget))
    ),
  }));

  growToBudget(allocations, capacity, effectiveBudget);
  shrinkToBudget(allocations, effectiveBudget);

  const result = allocations
    .filter((a) => a.granuleCount > 0)
    .sort((a, b) => a.collectionCumulusId - b.collectionCumulusId);

  return { allocations: result, total: sumAllocations(result) };
};

/**
 * Create the working table that every extraction query joins against.
 *
 * `TEMP` so the extractor needs no write privilege on the source cluster. `ord` is a
 * deterministic round-robin rank across collections, which is what makes the tiers true
 * prefixes of each other: tier N is `WHERE ord < N`, and because the ranking interleaves
 * collections, even the 10-granule tier spans several of them.
 *
 * Each collection contributes its most recently updated granules. That ordering is served
 * by the `(collection_cumulus_id, updated_at)` index (or, for a collection that dominates
 * its partition, the `updated_at` index), so each read is a short backward index scan.
 * Ordering by `cumulus_id` instead looks equally cheap to the planner but is not: the
 * primary key leads with `cumulus_id`, so finding a collection's newest ids means walking
 * back past every other collection's rows in the same hash partition. On a 694M-granule
 * source that took 20+ seconds per collection; this takes well under one.
 *
 * Each sampled granule's provider and PDR ids are kept here too, so that the dimension
 * queries in `extractionQueries` never have to join back to `granules`.
 *
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {CollectionAllocation[]} params.allocations
 * @param {string} [params.tableName]
 * @param {(done: number, total: number) => void} [params.onProgress]
 * @returns {Promise<{rowCount: number}>}
 */
const buildSampleTable = async ({
  client, allocations, tableName = SAMPLE_TABLE, onProgress = noop,
}) => {
  await client.query(`DROP TABLE IF EXISTS ${tableName}`);
  await client.query(
    `CREATE TEMP TABLE ${tableName} (
       cumulus_id            BIGINT NOT NULL,
       collection_cumulus_id INTEGER NOT NULL,
       granule_id            TEXT NOT NULL,
       updated_at            TIMESTAMPTZ,
       provider_cumulus_id   INTEGER,
       pdr_cumulus_id        INTEGER,
       ord                   BIGINT,
       PRIMARY KEY (cumulus_id, collection_cumulus_id)
     )`
  );

  // One statement per collection, each pruning to a single partition, rather than one
  // query with an IN list that would touch every partition.
  for (const [index, allocation] of allocations.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO ${tableName}
         (cumulus_id, collection_cumulus_id, granule_id, updated_at,
          provider_cumulus_id, pdr_cumulus_id)
       SELECT cumulus_id, collection_cumulus_id, granule_id, updated_at,
              provider_cumulus_id, pdr_cumulus_id
         FROM granules
        WHERE collection_cumulus_id = $1
        ORDER BY updated_at DESC
        LIMIT $2`,
      [allocation.collectionCumulusId, allocation.granuleCount]
    );
    onProgress(index + 1, allocations.length);
  }

  // Interleave: rank within each collection, then order by (rank, collection), so any
  // prefix of `ord` is spread over every collection present.
  await client.query(
    `WITH ranked AS (
       SELECT cumulus_id, collection_cumulus_id,
              row_number() OVER (ORDER BY rank_in_collection, collection_cumulus_id) - 1
                AS new_ord
         FROM (
           SELECT cumulus_id, collection_cumulus_id,
                  row_number() OVER (
                    PARTITION BY collection_cumulus_id
                    ORDER BY updated_at DESC NULLS LAST, cumulus_id DESC
                  ) AS rank_in_collection
             FROM ${tableName}
         ) per_collection
     )
     UPDATE ${tableName} s
        SET ord = r.new_ord
       FROM ranked r
      WHERE s.cumulus_id = r.cumulus_id
        AND s.collection_cumulus_id = r.collection_cumulus_id`
  );

  await client.query(`CREATE INDEX ON ${tableName} (ord)`);
  await client.query(`ANALYZE ${tableName}`);

  const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${tableName}`);
  return { rowCount: Number(rows[0].n) };
};

/**
 * Render a column list for a SELECT, qualified by an alias.
 *
 * @param {import('./schema').ColumnDef[]} columns
 * @param {string} alias
 * @returns {string}
 */
const qualifiedColumns = (columns, alias) =>
  columns.map((c) => `${alias}."${c.column}"`).join(', ');

/**
 * Build the per-table extraction SELECTs for one tier.
 *
 * Every query is bounded by `ord < limit` against the sample table, which is what makes a
 * tier a prefix of the next. The column list is explicit and comes from introspection —
 * never `SELECT *` — so that the manifest's recorded order is exactly the CSV's order.
 *
 * Two edges need care:
 *
 * - `executions.parent_cumulus_id` is a self-FK. A sampled execution's parent often falls
 *   outside the sample, so the parent columns are emitted as NULL unless the parent is
 *   itself in the extracted set. Both must go NULL together, since the FK is composite.
 * - `granules.pdr_cumulus_id` and `provider_cumulus_id` are nullable, so an unsampled
 *   referent is emitted as NULL rather than dropping the granule.
 *
 * Rules are the rules attached to the bundle's collections, and are rewritten on the way
 * out: `enabled` is forced to false and `arn` / `log_event_arn` to NULL. A rule inserted
 * directly into a database has no EventBridge, SNS or Kinesis trigger, so it cannot fire
 * — but its ARN columns would still name the *source* stack's trigger resources, which
 * live in the same AWS account. Disabling or deleting such a rule through the target's API
 * would then tear those down. Clearing them makes the copy inert.
 *
 * @param {object} params
 * @param {import('./schema').Introspection} params.introspection
 * @param {number} params.limit - tier size in granules
 * @param {string} [params.sampleTable]
 * @returns {Record<string, string>}
 */
const extractionQueries = ({ introspection, limit, sampleTable = SAMPLE_TABLE }) => {
  const sampled = `(SELECT cumulus_id, collection_cumulus_id, provider_cumulus_id,
                            pdr_cumulus_id
                       FROM ${sampleTable} WHERE ord < ${limit})`;

  /**
   * Rows of a child table belonging to the sampled granules, fetched with one index lookup
   * per sampled granule.
   *
   * Written as a LATERAL subquery with OFFSET 0 on purpose. A plain join lets the planner
   * choose a merge or hash join against the whole child table; on a source with 5.2 billion
   * `files` rows, that means scanning all of them. OFFSET 0 stops the subquery being
   * flattened into a join, so each sampled granule drives an index scan, and run-time
   * partition pruning confines each scan to the one partition holding that granule.
   *
   * @param {string} table
   * @param {string} alias
   * @param {string} condition - references the sample row as `s`
   * @returns {string}
   */
  const perGranule = (table, alias, condition) => `${sampled} s
    CROSS JOIN LATERAL (SELECT * FROM ${table} ${alias}0 WHERE ${condition(`${alias}0`)}
                        OFFSET 0) ${alias}`;

  const pdrSet = `(
    SELECT DISTINCT pdr_cumulus_id AS cumulus_id
      FROM ${sampled} s
     WHERE pdr_cumulus_id IS NOT NULL
  )`;

  // Executions reachable from the sampled granules, plus those referenced by the PDRs of
  // those granules — pdrs.execution_cumulus_id is a composite FK we must satisfy.
  const executionSet = `(
    SELECT DISTINCT ge.execution_cumulus_id AS cumulus_id,
                    ge.execution_created_at AS created_at
      FROM ${perGranule('granules_executions', 'ge', (a) => `${a}.granule_cumulus_id = s.cumulus_id
                        AND ${a}.collection_cumulus_id = s.collection_cumulus_id`)}
    UNION
    SELECT DISTINCT p.execution_cumulus_id, p.execution_created_at
      FROM pdrs p
     WHERE p.execution_cumulus_id IS NOT NULL
       AND p.cumulus_id IN (SELECT cumulus_id FROM ${pdrSet} ps)
  )`;

  // Every collection the bundle needs: those of sampled granules, of their executions, and
  // of their PDRs. Rules are selected against this same set.
  const collectionSet = `(
    SELECT DISTINCT collection_cumulus_id AS cumulus_id FROM ${sampled}
    UNION
    SELECT DISTINCT e.collection_cumulus_id
      FROM executions e
      JOIN ${executionSet} es
        ON es.cumulus_id = e.cumulus_id
       AND es.created_at = e.created_at
     WHERE e.collection_cumulus_id IS NOT NULL
    UNION
    SELECT DISTINCT p.collection_cumulus_id
      FROM pdrs p JOIN ${pdrSet} ps ON ps.cumulus_id = p.cumulus_id
  )`;

  const ruleSet = `(
    SELECT r.cumulus_id, r.provider_cumulus_id
      FROM rules r
     WHERE r.collection_cumulus_id IN (SELECT cumulus_id FROM ${collectionSet} cs)
  )`;

  const ruleSelect = introspection.rules
    .map((column) => {
      if (column.column === 'enabled') return 'false AS "enabled"';
      if (column.column === 'arn') return 'NULL::text AS "arn"';
      if (column.column === 'log_event_arn') return 'NULL::text AS "log_event_arn"';
      return `r."${column.column}"`;
    })
    .join(', ');

  const granuleColumns = introspection.granules;
  const executionColumns = introspection.executions;

  /**
   * Executions, with the self-FK resolved against the extracted set.
   */
  const executionSelect = executionColumns
    .map((column) => {
      if (column.column === 'parent_cumulus_id') {
        return 'CASE WHEN parent.cumulus_id IS NULL THEN NULL'
          + ' ELSE e."parent_cumulus_id" END AS "parent_cumulus_id"';
      }
      if (column.column === 'parent_created_at') {
        return 'CASE WHEN parent.cumulus_id IS NULL THEN NULL'
          + ' ELSE e."parent_created_at" END AS "parent_created_at"';
      }
      return `e."${column.column}"`;
    })
    .join(', ');

  return {
    collections: `
      SELECT ${qualifiedColumns(introspection.collections, 'c')}
        FROM collections c
       WHERE c.cumulus_id IN (SELECT cumulus_id FROM ${collectionSet} cs)
       ORDER BY c.cumulus_id`,

    providers: `
      SELECT ${qualifiedColumns(introspection.providers, 'pr')}
        FROM providers pr
       WHERE pr.cumulus_id IN (
               SELECT DISTINCT provider_cumulus_id
                 FROM ${sampled} s
                WHERE provider_cumulus_id IS NOT NULL
               UNION
               SELECT DISTINCT p.provider_cumulus_id
                 FROM pdrs p JOIN ${pdrSet} ps ON ps.cumulus_id = p.cumulus_id
               UNION
               SELECT DISTINCT rs.provider_cumulus_id
                 FROM ${ruleSet} rs
                WHERE rs.provider_cumulus_id IS NOT NULL
             )
       ORDER BY pr.cumulus_id`,

    rules: `
      SELECT ${ruleSelect}
        FROM rules r
        JOIN ${ruleSet} rs ON rs.cumulus_id = r.cumulus_id
       ORDER BY r.cumulus_id`,

    async_operations: `
      SELECT ${qualifiedColumns(introspection.async_operations, 'ao')}
        FROM async_operations ao
       WHERE ao.cumulus_id IN (
               SELECT DISTINCT e.async_operation_cumulus_id
                 FROM executions e
                 JOIN ${executionSet} es
                   ON es.cumulus_id = e.cumulus_id
                  AND es.created_at = e.created_at
                WHERE e.async_operation_cumulus_id IS NOT NULL
             )
       ORDER BY ao.cumulus_id`,

    executions: `
      SELECT ${executionSelect}
        FROM executions e
        JOIN ${executionSet} es
          ON es.cumulus_id = e.cumulus_id
         AND es.created_at = e.created_at
        LEFT JOIN ${executionSet} parent
          ON parent.cumulus_id = e.parent_cumulus_id
         AND parent.created_at = e.parent_created_at
       ORDER BY e.cumulus_id`,

    pdrs: `
      SELECT ${qualifiedColumns(introspection.pdrs, 'p')}
        FROM pdrs p
        JOIN ${pdrSet} ps ON ps.cumulus_id = p.cumulus_id
       ORDER BY p.cumulus_id`,

    // No ORDER BY on the per-granule tables: the loader does not depend on row order, and
    // sorting millions of rows would spill to disk on the source for nothing.
    granules: `
      SELECT ${qualifiedColumns(granuleColumns, 'g')}
        FROM ${perGranule('granules', 'g', (a) => `${a}.cumulus_id = s.cumulus_id
                          AND ${a}.collection_cumulus_id = s.collection_cumulus_id`)}`,

    files: `
      SELECT ${qualifiedColumns(introspection.files, 'f')}
        FROM ${perGranule('files', 'f', (a) => `${a}.granule_cumulus_id = s.cumulus_id
                          AND ${a}.collection_cumulus_id = s.collection_cumulus_id`)}`,

    granules_executions: `
      SELECT ${qualifiedColumns(introspection.granules_executions, 'ge')}
        FROM ${perGranule('granules_executions', 'ge', (a) => `${a}.granule_cumulus_id = s.cumulus_id
                          AND ${a}.collection_cumulus_id = s.collection_cumulus_id`)}`,
  };
};

module.exports = {
  EXACT_COUNT_LIMIT,
  SAMPLE_TABLE,
  buildSampleTable,
  estimateCollectionStats,
  extractionQueries,
  getCollectionStats,
  planAllocation,
  qualifiedColumns,
};

'use strict';

/* eslint-disable no-await-in-loop */

/**
 * Build a small but structurally complete granule closure in a test database.
 *
 * "Structurally complete" means every table in SEED_TABLES has rows, and the awkward edges
 * the extractor has to handle are all present:
 *
 *  - an execution whose parent is also in the set (the self-FK resolves)
 *  - an execution whose parent is NOT in any sample (the self-FK must go NULL)
 *  - granules with a NULL pdr_cumulus_id and a NULL provider_cumulus_id
 *  - granules with a non-NULL pdr, so pdrs and their executions join the closure
 *  - several files per granule, spread across collections
 *  - an *enabled* rule with trigger ARNs on every collection, one of them using a provider
 *    that nothing else references, so the extractor must pull that provider in too
 */

/**
 * @param {object} params
 * @param {import('pg').Client} params.client
 * @param {number} [params.collectionCount]
 * @param {number} [params.granulesPerCollection]
 * @param {number} [params.filesPerGranule]
 * @returns {Promise<object>}
 */
const seedSourceDatabase = async ({
  client,
  collectionCount = 4,
  granulesPerCollection = 25,
  filesPerGranule = 3,
}) => {
  const collectionIds = [];
  const providerIds = [];

  for (let c = 0; c < collectionCount; c += 1) {
    const { rows } = await client.query(
      `INSERT INTO collections (
         name, version, sample_file_name, granule_id_extraction_regex,
         granule_id_validation_regex, files, meta, cmr_provider, metrics_provider,
         created_at, updated_at
       ) VALUES ($1, '001', 'file.hdf', '(.*)', '^.*$', $2, $3, 'cmr-prov',
                 'metrics-prov', now(), now())
       RETURNING cumulus_id`,
      [
        `MOD09GQ_${c}`,
        JSON.stringify([{ regex: '.*\\.hdf$', sampleFileName: 'f.hdf' }]),
        JSON.stringify({ shortName: `MOD09GQ_${c}`, note: 'multi\nline, "quoted"' }),
      ]
    );
    collectionIds.push(Number(rows[0].cumulus_id));
  }

  for (let p = 0; p < 2; p += 1) {
    const { rows } = await client.query(
      `INSERT INTO providers (name, protocol, host, allowed_redirects, created_at, updated_at)
       VALUES ($1, 'https', $2, $3, now(), now())
       RETURNING cumulus_id`,
      [`provider_${p}`, `provider${p}.example.com`, ['a,b', 'c']]
    );
    providerIds.push(Number(rows[0].cumulus_id));
  }

  // A provider referenced only by a rule.
  const { rows: ruleProviderRows } = await client.query(
    `INSERT INTO providers (name, protocol, host, created_at, updated_at)
     VALUES ('rule_only_provider', 's3', 'rule-only-bucket', now(), now())
     RETURNING cumulus_id`
  );
  const ruleOnlyProviderId = Number(ruleProviderRows[0].cumulus_id);

  const ruleIds = [];
  for (const [index, collectionCumulusId] of collectionIds.entries()) {
    const { rows } = await client.query(
      `INSERT INTO rules (
         name, workflow, collection_cumulus_id, provider_cumulus_id, type, enabled,
         value, arn, log_event_arn, payload, created_at, updated_at
       ) VALUES ($1, 'IngestGranule', $2, $3, 'kinesis', true, $4, $5, $6, $7, now(), now())
       RETURNING cumulus_id`,
      [
        `seed_rule_${index}`,
        collectionCumulusId,
        index === 0 ? ruleOnlyProviderId : providerIds[index % providerIds.length],
        `arn:aws:kinesis:us-west-2:000000000000:stream/source-${index}`,
        `arn:aws:lambda:us-west-2:000000000000:event-source-mapping:source-${index}`,
        `arn:aws:lambda:us-west-2:000000000000:event-source-mapping:log-${index}`,
        JSON.stringify({ note: 'rule payload' }),
      ]
    );
    ruleIds.push(Number(rows[0].cumulus_id));
  }

  const { rows: asyncRows } = await client.query(
    `INSERT INTO async_operations (id, description, operation_type, status, created_at, updated_at)
     VALUES (gen_random_uuid(), 'seed fixture', 'Data Migration', 'SUCCEEDED', now(), now())
     RETURNING cumulus_id`
  );
  const asyncOperationId = Number(asyncRows[0].cumulus_id);

  // An "orphan parent" execution, created first and deliberately given a created_at far in
  // the past. Children reference it, but because it belongs to no collection in the sample
  // it will usually fall outside the extracted set, exercising the self-FK NULLing.
  const { rows: orphanRows } = await client.query(
    `INSERT INTO executions (arn, url, status, created_at, updated_at, timestamp)
     VALUES ($1, $2, 'completed', now() - interval '400 days', now(), now())
     RETURNING cumulus_id, created_at`,
    ['arn:orphan:parent', 'https://example.com/orphan']
  );
  const orphanParent = {
    cumulusId: Number(orphanRows[0].cumulus_id),
    createdAt: orphanRows[0].created_at,
  };

  const granules = [];
  const executions = [];
  const pdrs = [];

  for (const [index, collectionCumulusId] of collectionIds.entries()) {
    const providerCumulusId = providerIds[index % providerIds.length];

    // One PDR per collection, wired to its own execution via the composite FK.
    const { rows: pdrExecRows } = await client.query(
      `INSERT INTO executions (
         arn, url, status, collection_cumulus_id, async_operation_cumulus_id,
         created_at, updated_at, timestamp, workflow_name
       ) VALUES ($1, $2, 'completed', $3, $4, now() - interval '10 days', now(), now(),
                 'IngestAndPublishGranule')
       RETURNING cumulus_id, created_at`,
      [`arn:pdr:exec:${index}`, `https://example.com/pdr-exec/${index}`,
        collectionCumulusId, asyncOperationId]
    );
    const pdrExecution = {
      cumulusId: Number(pdrExecRows[0].cumulus_id),
      createdAt: pdrExecRows[0].created_at,
    };
    executions.push(pdrExecution);

    const { rows: pdrRows } = await client.query(
      `INSERT INTO pdrs (
         collection_cumulus_id, provider_cumulus_id, execution_cumulus_id,
         execution_created_at, status, name, progress, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'completed', $5, 100, now(), now())
       RETURNING cumulus_id`,
      [collectionCumulusId, providerCumulusId, pdrExecution.cumulusId,
        pdrExecution.createdAt, `PDR_${index}.PDR`]
    );
    const pdrCumulusId = Number(pdrRows[0].cumulus_id);
    pdrs.push(pdrCumulusId);

    for (let g = 0; g < granulesPerCollection; g += 1) {
      // Every third granule has no PDR and no provider, so the nullable FKs are exercised.
      const sparse = g % 3 === 0;
      const granuleId = `MOD09GQ.A${index}${String(g).padStart(6, '0')}.006.hdf`;

      const { rows: granuleRows } = await client.query(
        `INSERT INTO granules (
           granule_id, producer_granule_id, status, collection_cumulus_id,
           pdr_cumulus_id, provider_cumulus_id, published, duration, product_volume,
           error, query_fields, cmr_link, created_at, updated_at, timestamp,
           beginning_date_time, ending_date_time
         ) VALUES ($1, $2, 'completed', $3, $4, $5, true, 12.5, $6, $7, $8, $9,
                   now() - ($10 || ' hours')::interval, now(), now(),
                   now() - interval '30 days', now() - interval '29 days')
         RETURNING cumulus_id`,
        [
          granuleId,
          `producer-${granuleId}`,
          collectionCumulusId,
          sparse ? null : pdrCumulusId,
          sparse ? null : providerCumulusId,
          '9007199254740993',
          JSON.stringify({ Error: 'None', Cause: 'multi\nline, "quoted"' }),
          JSON.stringify({ foo: ['bar', 'baz'] }),
          `https://cmr.example.com/${granuleId}`,
          String(g),
        ]
      );
      const granuleCumulusId = Number(granuleRows[0].cumulus_id);
      granules.push({ granuleCumulusId, collectionCumulusId, granuleId });

      for (let f = 0; f < filesPerGranule; f += 1) {
        await client.query(
          `INSERT INTO files (
             granule_cumulus_id, collection_cumulus_id, bucket, key, file_size,
             file_name, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
          [
            granuleCumulusId, collectionCumulusId,
            `source-protected-bucket-${index}`,
            `${collectionCumulusId}/${granuleId}/part${f}.hdf`,
            String(1024 * (f + 1)),
            `part${f}.hdf`,
          ]
        );
      }

      // One execution per granule. Half descend from the orphan parent, half from the
      // collection's PDR execution, so both self-FK outcomes appear.
      const parent = g % 2 === 0 ? orphanParent : pdrExecution;
      const { rows: execRows } = await client.query(
        `INSERT INTO executions (
           arn, url, status, collection_cumulus_id, parent_cumulus_id, parent_created_at,
           created_at, updated_at, timestamp, workflow_name, original_payload
         ) VALUES ($1, $2, 'completed', $3, $4, $5, now() - ($6 || ' hours')::interval,
                   now(), now(), 'IngestGranule', $7)
         RETURNING cumulus_id, created_at`,
        [
          `arn:granule:exec:${index}:${g}`,
          `https://example.com/granule-exec/${index}/${g}`,
          collectionCumulusId,
          parent.cumulusId,
          parent.createdAt,
          String(g),
          JSON.stringify({ granuleId }),
        ]
      );
      const execution = {
        cumulusId: Number(execRows[0].cumulus_id),
        createdAt: execRows[0].created_at,
      };
      executions.push(execution);

      await client.query(
        `INSERT INTO granules_executions (
           granule_cumulus_id, collection_cumulus_id, execution_cumulus_id,
           execution_created_at
         ) VALUES ($1, $2, $3, $4)`,
        [granuleCumulusId, collectionCumulusId, execution.cumulusId, execution.createdAt]
      );
    }
  }

  return {
    collectionIds,
    providerIds,
    ruleOnlyProviderId,
    ruleIds,
    asyncOperationId,
    orphanParent,
    granules,
    executions,
    pdrs,
    totals: {
      collections: collectionIds.length,
      granules: granules.length,
      files: granules.length * filesPerGranule,
    },
  };
};

module.exports = { seedSourceDatabase };

/* eslint-enable no-await-in-loop */

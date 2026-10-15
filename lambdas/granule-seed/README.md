# @cumulus/granule-seed

Seed a Cumulus stack's database with real granule records, sampled from another Cumulus
database, for performance and query-plan testing.

The tool works in two halves. **Extract** takes one sample of granules from a source
database, together with every row they depend on, and writes it to S3 as gzipped CSV
"bundles" in nested size tiers. **Load** reads one tier of a bundle into a target stack's
database, remaps its surrogate keys, and can add synthetic executions. **Revert** removes
everything a load inserted. Extraction runs once; the bundle can then be loaded into any
number of stacks, so every stack gets identical data and results are comparable.

## What gets extracted

Each bundle holds the granule foreign-key closure, nine tables in dependency order:

`collections`, `providers`, `async_operations`, `rules`, `executions`, `pdrs`, `granules`,
`files`, `granules_executions`

`rules` holds the rules attached to the bundle's collections. They are copied with
`enabled` set to false and `arn` and `log_event_arn` cleared. A rule inserted directly into
a database has no trigger, so it cannot fire. Its ARN columns would still name the source
stack's trigger resources, though, and disabling or deleting the rule through the target's
API would then remove those resources. **Do not enable a seeded rule**: its `value` and
`queue_url` still point at the source stack's streams and queues.

`reconciliation_reports` is excluded, because nothing reaches it from a granule. The
`*_global_unique` tables are excluded because triggers maintain them on the target.

Where a sampled execution's parent execution is not itself in the bundle, both
`parent_cumulus_id` and `parent_created_at` are written as NULL so that the bundle's
foreign keys close.

## Tiers

| Tier   | Granules  |
| ------ | --------- |
| `10`   | 10        |
| `100`  | 100       |
| `1k`   | 1,000     |
| `10k`  | 10,000    |
| `100k` | 100,000   |
| `1m`   | 1,000,000 |

A tier counts granules. Its file count depends on the source's files-per-granule ratio,
which each tier's manifest records as `stats.filesPerGranule`.

Tiers are nested: every tier is a strict subset of the next, so the `1k` and `1m` tiers are
the same dataset at two sizes. One run writes the requested tier and every smaller one.

Granules are allocated across collections in proportion to their size, with a floor so that
small collections still appear. When a tier is smaller than the number of collections, it
takes one granule from each of the largest collections. Collection sizes come from planner
statistics, so the extractor never counts the granules table. Collections too small to
appear in those statistics are not sampled. Each collection contributes its most recently
updated granules.

## Running an extraction

Run the extractor from a host that can reach the source database, such as an EC2 instance
in the source stack's VPC. It needs Node.js 22.21.1 or later and access to the npm registry.
There is no build step:

```bash
git clone https://github.com/nasa/cumulus.git
cd cumulus/lambdas/granule-seed
npm install --no-workspaces
```

Start with a dry run. It connects, reads per-collection granule counts, and prints the
allocation plan without writing anything to S3:

```bash
export databaseCredentialSecretArn=arn:aws:secretsmanager:...   # or PG_* below
node bin/extract.js --dry-run --tier 1m
```

Extract the small tiers first and check their manifests before running the full `1m`
extraction:

```bash
node bin/extract.js --bucket <bucket> --prefix <prefix> --tier 1k
```

A `1m` extraction is a long job. Run it under `tmux` or `nohup` so that a dropped SSH
session does not kill it partway through.

### Options

| Flag | Short | Environment variable | Default | Description |
| ---- | ----- | -------------------- | ------- | ----------- |
| `--bucket` | `-b` | `SEED_BUCKET` | | S3 bucket for bundles. Required unless `--dry-run` |
| `--prefix` | `-p` | `SEED_PREFIX` | `cumulus` | S3 key prefix |
| `--tier` | `-t` | `SEED_TIER` | `1m` | Largest tier to write |
| `--snapshot` | `-s` | `SEED_SNAPSHOT` | `v1-<today>` | Snapshot version segment of the S3 key |
| `--floor` | | `SEED_COLLECTION_FLOOR` | `1` | Minimum granules per collection, where the budget allows |
| `--source-label` | | `SEED_SOURCE_LABEL` | database name | Source label recorded in the manifest |
| `--dry-run` | `-n` | | | Plan only, write nothing |
| `--local` | | | | Disable TLS, for a local Postgres |

Values given on the command line override environment variables.

### Database connection

The connection comes from `@cumulus/db`. If `databaseCredentialSecretArn` is set, the
credentials are read from that Secrets Manager secret. Otherwise the extractor uses
`PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` and, optionally, `PG_PORT`.

Two requirements on the source database:

- **Use the writer endpoint.** The extractor builds its sample in a temporary table, and a
  hot-standby reader cannot create temporary tables.
- **Expect one long transaction.** The whole extraction runs in a single
  `REPEATABLE READ` transaction, so that every tier and table sees the same snapshot.
  The transaction is rolled back at the end and writes nothing to the source, but while it
  is open it holds back vacuum's cleanup horizon. Clear a multi-hour run with the database's
  owners first.

`statement_timeout` and `idle_in_transaction_session_timeout` are set to `0` for the
extractor's session.

## Loading a tier

```bash
node bin/load.js --bucket <bucket> --prefix <prefix> --snapshot v1-2026-09-23 \
  --tier 10 --dry-run
node bin/load.js --bucket <bucket> --prefix <prefix> --snapshot v1-2026-09-23 --tier 10
```

The loader:

1. Reads the tier's manifest and checks the bundle's columns against the target's schema,
   refusing the load if any column cannot be matched (see `--fill`).
2. Copies each CSV into a `TEMP` staging table. Temp tables are private to the session and
   removed when it disconnects.
3. Generates synthetic executions (see below) into staging.
4. Checks every value the target keeps unique across the database, such as granule IDs,
   file bucket/key pairs, execution ARNs and URLs, and PDR names. If any already exist, it
   stops before inserting anything.
5. Inserts everything in one transaction. Collections, providers, async operations and
   rules that already exist, matched by their natural keys, are reused rather than
   duplicated. Every other row gets a new ID from the target table's own sequence, and
   every foreign key is remapped through the staging tables.
6. Before committing, writes a record of every ID it inserted to
   `s3://<bucket>/<prefix>/granule-seed/loads/<loadId>.json`. Revert works from this record.

A failed load leaves the target unchanged. `--dry-run` runs steps 1 to 4 and writes no
record.

Granule IDs are loaded unchanged, so one database can hold only one load of a given
dataset. To load a larger tier, revert the current load first. Tiers are nested, so the
larger tier contains every granule of the smaller one.

A load leaves nothing in the target database except the seeded Cumulus rows. The loader
and revert never run `DROP` or `TRUNCATE` and never create a permanent table. On some
stacks, including CC SIT, the Cumulus database user may not run either statement: those
databases have pglogical installed, which refuses them.

### Synthetic executions

The source may have no executions to copy. `--executions-per-granule` (`-e`, default `2`)
generates that many executions per loaded granule, each linked to its granule through
`granules_executions`:

- **Status:** about 85% `completed`, 12% `failed` (with an `error` payload) and 3%
  `running`.
- **Workflow:** alternates between `IngestGranule` and `PublishGranule`.
- **`created_at`:** within the last 180 days, so the rows fall in the target's quarterly
  partitions rather than `executions_default`.
- **ARNs:** name the account `000000000000` and a `granule-seed-` state machine, so they
  never point at a real Step Functions execution.

Values are derived from a hash of the granule ID, so loading the same tier again produces
the same executions. Pass `-e 0` to generate none.

## Reverting a load

```bash
node bin/revert.js --bucket <bucket> --prefix <prefix> --list
node bin/revert.js --bucket <bucket> --prefix <prefix> --load-id <loadId>
```

Revert reads the load's record from S3 and deletes, in one transaction, every row the load
inserted, working from child tables to parents. It deletes collections, providers, async
operations and rules only if the load created them; rows that already existed are left
alone. The target's triggers keep the `*_global_unique` tables in step. Revert refuses to
run against a database other than the one the load went into, and marks the record
`reverted` afterwards.

## Running against a stack's database

Stack databases are in private subnets. One way to reach one from a workstation is an SSM
port forward through one of the stack's own ECS container instances:

```bash
aws ssm start-session --target <CumulusECSCluster instance id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host=<rds writer endpoint>,portNumber=5432,localPortNumber=15432
```

Then set `PG_HOST=localhost`, `PG_PORT=15432`, and `PG_USER`, `PG_PASSWORD` and
`PG_DATABASE` from the stack's `<prefix>_db_login…` secret. Also set
`REJECT_UNAUTHORIZED=false`: the connection is still TLS, but the certificate is issued to
the RDS hostname rather than `localhost`.

## Bundle layout

```text
s3://<bucket>/<prefix>/granule-seed/v1/<snapshot>/
  manifest.json                  summary of every tier written
  10/  100/  1k/  10k/  100k/  1m/
    manifest.json                per-tier manifest
    collections.csv.gz  providers.csv.gz  async_operations.csv.gz
    executions.csv.gz   pdrs.csv.gz       granules.csv.gz
    files.csv.gz        granules_executions.csv.gz
```

Each CSV is written by the database's own `COPY ... TO STDOUT WITH (FORMAT csv, HEADER)`,
so `jsonb`, arrays, timestamps, large `bigint` values, and the difference between NULL and
an empty string are preserved exactly.

A tier's manifest records:

- the source database, server version, migration head, partition counts, and a schema
  fingerprint
- each table's full column definitions, in CSV column order
- each table's row count, as reported by the database, and a sha256 of the uncompressed CSV
- the sampling allocation and the measured files-per-granule ratio

Each tier's `manifest.json` is written only after all of that tier's CSV files have
uploaded. If a tier has no manifest, its extraction did not finish, and the loader will not
load it.

## What seeded data is good for

The seeded rows are real, so they have realistic ID formats, payload sizes, status mixes,
and per-collection distributions. Use them for API read-path and pagination benchmarks,
query planning and index tuning, partition behaviour, and migration rehearsals.

Executions are synthetic unless the source has real ones. Their payloads are small and
their ARNs are placeholders.

The rows still point at the source environment. `files.bucket` and `files.key` name the
source's S3 objects, execution ARNs name its Step Functions executions, and `cmr_link`
names its CMR records. Do not use seeded data for end-to-end ingest, for reconciliation
reports, which would report every file as missing, for bulk granule deletion, which would
attempt real S3 deletes, or for anything that publishes to CMR.

Take an Aurora snapshot of any target database whose contents matter before seeding it.

## Tests

The tests need the local unit-test stack for Postgres and LocalStack S3:

```bash
npm run start-unit-test-stack   # from the repository root
cd lambdas/granule-seed
LOCALSTACK_HOST=127.0.0.1 npm test
```

The end-to-end extraction test builds its source database with the partition counts a
deployed stack uses (64 granule, 256 file, 16 and 64 guard-table partitions), not the
migration code's smaller fallbacks.

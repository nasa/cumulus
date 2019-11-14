# @cumulus/ingest

@cumulus/ingest is a collection of modules for discovering and ingesting data.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Installation

```bash
npm install @cumulus/ingest
```

## Testing

Running tests locally requires [localstack](https://github.com/localstack/localstack).

With localstack running, you can run tests using:

```bash
LOCALSTACK_HOST=localhost npm test
```

## Modules

All modules are accessible using require: `require('@cumulus/ingest/<MODULE_NAME>')` or import: `import <MODULE_NAME> from '@cumulus/ingest/<MODULE_NAME>'`.

- [`consumer`](./consumer.js) - comsumer for SQS messages
- [`crypto`](./crypto.js) - provides encryption and decryption methods with a consistent API but differing mechanisms for dealing with encryption keys
- [`ftp`](./ftp.js) - for accessing FTP servers
- [`granule`](./granule.js) - discovers and ingests granules
- [`http`](./http.js) - for accessing data via HTTP and HTTPS
- [`lock`](./lock.js) - creates locks for S3 data
- [`log`](./log.js) - stringifies JS object logs for ElasticSearch indexing
- [`parse-pdr`](./parse-pdr.js) - tools for validating PDRs and generating PDRD and PAN messages
- [`pdr`](./pdr.js) - discovers and ingests pdrs
- [`queue`](./queue.js) - creates queues for ingesting data
- [`recursion`](./recursion.js) - handles recursion of a FTP/SFTP list operation
- [`sftp`](./sftp.js) - for accessing SFTP servers

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

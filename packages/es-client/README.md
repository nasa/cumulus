# @cumulus/es-client

Utilities for working with Elasticsearch.

## Usage

```bash
npm install @cumulus/es-client
```

## Notes

### Sorting

It is possible to sort the Elastic Search results by specifying `sort_by`,  `sort_key`, and `order` params.
If not provided, the default sorting will be applied (`{ timestamp: { order: 'desc' } }` as of this writing).

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's
future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

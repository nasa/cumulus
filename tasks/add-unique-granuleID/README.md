# @cumulus/add-unique-granuleID

This is a [Cumulus](https://nasa.github.io/cumulus) task which takes the following actions on each granule in an incoming set of payload granules:

- Adds the existing `granuleId` to the `producerGranuleId` key
- Updates the existing `granuleId` field to a 'unique' value based on the algorithim used in @cumulus/ingest `generateUniqueGranuleId`

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

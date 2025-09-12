# @cumulus/parse-pdr

`@cumulus/parse-pdr` parses a pdr file.

## Message Configuration

### Config

| field name | default | description
| --------   | ------- | ----------
| provider   | (required) | The cumulus-api provider object
| collection | (required) | The cumulus-api collection object
| bucket     | (required) | The internal bucket name (used for record keeping)
| stack      | (required) | Cumulus deployment stack name
| uniquifyGranuleId | false | If set to true in the configuration, granuleId will be a 'uniquified' value instead of the original value in the form <producerId>_<hash>
| hashLength |     8      | The length of the hash used for uniquification
| includeTimestampHashKey | false | A Boolean value for whether hashKey should use timestamp for uniquifying granuleIds

### Input

| field name | default | description
| --------   | ------- | ----------
| pdr        | (required) | the PDR object that should include the name and path of the pdr

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

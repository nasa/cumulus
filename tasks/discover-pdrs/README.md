# @cumulus/discover-pdrs

Discover PDRs in FTP/HTTP/HTTPS/SFTP/S3 endpoints

## Message Configuration

### Config

| field name    | default    | description
| ------------- | ---------- | -----------
| provider      | (required) | The cumulus-api provider object
| provider_path | (required) | The path of the PDRs on the provider
| collection    | (required) | The cumulus-api collection object
| bucket        | (required) | The internal bucket name (used for record keeping)
| stack         | (required) | Cumulus deployment stack name

### Input

None

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

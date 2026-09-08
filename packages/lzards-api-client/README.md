# @cumulus/lzards-api-client

A Node.js client to NASA's Level Zero and Repositories Data Store (LZARDS) API.

## Usage

```bash
npm install @cumulus/lzards-api-client
```

### Example

```javascript
const { submitQueryToLzards } = require('@cumulus/lzards-api-client/lzards');

const now = new Date().getTime();
const thirtyMinutesAgo = now - (1000 * 60 * 30);
const twoMinutesAgo = now - (1000 * 60 * 2);

const searchParams = {
    pageLimit: 25,
    'metadata[provider]': provider,
    'metadata[createdAt][gte]': thirtyMinutesAgo,
    'metadata[createdAt][lte]': twoMinutesAgo,
}

const response = await submitQueryToLzards({ searchParams });
```

### Required Environment Variables
| Name | Example |
| ---- | ------- |
| launchpad_api | https://api.launchpad.nasa.gov/icam/api/sm/v1 |
| lzards_api | https://lzards.sit.earthdata.nasa.gov/api/backups |
| lzards_launchpad_passphrase_secret_name |abc-tf-lzards-api-client-test-launchpad-passphraseXXXXX lzards_launchpad_certificate launchpad.pfx |
| stackName | abc-tf |
| system_bucket | abc-tf-internal |
## LZARDS API Docs

LZARDS API documentation is here:

- <https://wiki.earthdata.nasa.gov/display/LZARDS/LZARDS+User+Guide>
- <https://wiki.earthdata.nasa.gov/display/LZARDS/Advanced+Query+Functionality>

## Test

Test with `npm run test`.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

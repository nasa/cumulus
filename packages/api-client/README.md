# @cumulus/api-client

This module provides functions that facilitate programatic access to the Cumulus API for processing functions and integration testing.   These methods utilize a 'private' internal API lambda that utilizes the same underlying code the 'public' API Gateway utilizes.

## Usage

The various exports from this module provide wrappers around common calls to the Cumulus API.  By default they're utilizing the provided `cumulusApiClient.invokeApi` method as a callback, but an option to provide an alternate/wrapped version (e.g. for validation) is built in to all methods.

```bash
npm install @cumulus/api-client
```

### Example

```javascript
const { granules } = require('@cumulus/api-client');

const granule = await granules.getGranule({
  prefix: process.env.STACKNAME,
  granuleId,
  collectionId
});
```

The above example call will return the parsed JSON body of the response from the API (e.g. `JSON.parse(response.body)`).

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

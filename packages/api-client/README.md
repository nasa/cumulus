# @cumulus/api-client

This module provides classes that facilitate token handling/authorization for processing lambdas or other AWS code wishing to utilize the Cumulus archive API with authorization for processing.

## Usage

```bash
npm install @cumulus/api-client
```

Classes are provided for EarthData login and Launchpad access.    To utilize these, include `EdlApiClient` or `LaunchpadApiClient`, or utilize the `cumulusApiClientFactory` method to bring in Core environment defaults and subclass selection via configuration.

Specific configuration values are documented in the subclass constructors.

### Required Resources

Use of this class requires the following AWS resources (and permissions to use them):

* A dynamoDB table, used to cache token records
* A KMS key for use in encrypting and decrypting bearer tokens in the dynamo table
* Optionally, use with `cumulusApiClientFactory` and default environment variables requires access to AWS Secrets Manager and appropriate secrets added to the store

### Example

```javascript
const { EdlApiClient } = require('@cumulus/api-client');

config = {
    baseUrl: 'your api url/stage',
    username: 'edl username',
    password: 'edl password',
    kmsId: 'kmsId'
    tokenSecretName: 'row name for token caching'
    authTokenTable: 'dynamo table name to store cached tokens'
}
const apiClient = new EdlApiClient(config)
```

#### CumulusApiClient.get(requestPath, authRetry = 1)
##### Example
```javascript
const response = await apiClient.get('/granules/somegranuleId', 5)
```

This method utilizes getCacheAuthToken to obtain a Bearer token from the cache and utilize it to make a 'get' request to the api. If there is no token/the token is expired/invalid, a new token will be requested, the cache record updated and if appropriate the get request will be retried (up to the configured number of retries).

#### CumulusApiClient.getCacheAuthToken()
```javascript
const token = await apiClient.getCacheAuthToken()
```
This method returns an active bearer token from the configured cache.  Refresh/update behavior depends on subclass implementation

#### CumulusApiClient.createNewAuthToken
```javascript
const token = await apiClient.createNewAuthToken()
```

This method explicitly creates a new token via  API adds it to the cache and returns it


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
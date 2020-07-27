# @cumulus/earthdata-login-client

Utilities for OAuth authentication using
[NASA Earthdata Login](https://urs.earthdata.nasa.gov/).

## Versioning

Cumulus uses a modified semantic versioning scheme and minor releases likely
include breaking changes.

Before upgrade, please read the Cumulus
[release notes](https://github.com/nasa/cumulus/releases) before upgraded.

It is strongly recommended you do not use `^` in your `package.json` to
automatically update to new minor versions. Instead, pin the version or use `~`
to automatically update to new patch versions.

## Installation

```bash
$ npm install @cumulus/earthdata-login-client
```

## Usage

```js
const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

const client = new EarthdataLogin({
  clientId: 'my-client-id',
  clientPassword: 'my-client-password',
  earthdataLoginUrl: 'https://earthdata.login.nasa.gov',
  redirectUri: 'http://my-api.com'
});
```

## API

<a name="EarthdataLoginClient"></a>

## EarthdataLoginClient
A client for the Earthdata Login API

**Kind**: global class  

* [EarthdataLoginClient](#EarthdataLoginClient)
    * [new EarthdataLoginClient(params)](#new_EarthdataLoginClient_new)
    * [.getAuthorizationUrl([state])](#EarthdataLoginClient+getAuthorizationUrl) ⇒ <code>string</code>
    * [.getAccessToken(authorizationCode)](#EarthdataLoginClient+getAccessToken) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.refreshAccessToken(refreshToken)](#EarthdataLoginClient+refreshAccessToken) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.getTokenUsername(params)](#EarthdataLoginClient+getTokenUsername) ⇒ <code>Promise.&lt;string&gt;</code>

<a name="new_EarthdataLoginClient_new"></a>

### new EarthdataLoginClient(params)

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.clientId | <code>string</code> | see example |
| params.clientPassword | <code>string</code> | see example |
| params.earthdataLoginUrl | <code>string</code> | see example |
| params.redirectUri | <code>string</code> | see example |

**Example**  
```js
const oAuth2Provider = new EarthdataLogin({
  clientId: 'my-client-id',
  clientPassword: 'my-client-password',
  earthdataLoginUrl: 'https://earthdata.login.nasa.gov',
  redirectUri: 'http://my-api.com'
});
```
<a name="EarthdataLoginClient+getAuthorizationUrl"></a>

### earthdataLoginClient.getAuthorizationUrl([state]) ⇒ <code>string</code>
Get a URL of the Earthdata Login authorization endpoint

**Kind**: instance method of [<code>EarthdataLoginClient</code>](#EarthdataLoginClient)  
**Returns**: <code>string</code> - the Earthdata Login authorization URL  

| Param | Type | Description |
| --- | --- | --- |
| [state] | <code>string</code> | an optional state to pass to Earthdata Login |

<a name="EarthdataLoginClient+getAccessToken"></a>

### earthdataLoginClient.getAccessToken(authorizationCode) ⇒ <code>Promise.&lt;Object&gt;</code>
Given an authorization code, request an access token and associated
information from the Earthdata Login service.

Returns an object with the following properties:

- accessToken
- refreshToken
- username
- expirationTime (in seconds)

**Kind**: instance method of [<code>EarthdataLoginClient</code>](#EarthdataLoginClient)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - access token information  

| Param | Type | Description |
| --- | --- | --- |
| authorizationCode | <code>string</code> | an OAuth2 authorization code |

<a name="EarthdataLoginClient+refreshAccessToken"></a>

### earthdataLoginClient.refreshAccessToken(refreshToken) ⇒ <code>Promise.&lt;Object&gt;</code>
Given a refresh token, request an access token and associated information
from the Earthdata Login service.

Returns an object with the following properties:

- accessToken
- refreshToken
- username
- expirationTime (in seconds)

**Kind**: instance method of [<code>EarthdataLoginClient</code>](#EarthdataLoginClient)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - access token information  

| Param | Type | Description |
| --- | --- | --- |
| refreshToken | <code>string</code> | an OAuth2 refresh token |

<a name="EarthdataLoginClient+getTokenUsername"></a>

### earthdataLoginClient.getTokenUsername(params) ⇒ <code>Promise.&lt;string&gt;</code>
Query the Earthdata Login API for the UID associated with a token

**Kind**: instance method of [<code>EarthdataLoginClient</code>](#EarthdataLoginClient)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the UID associated with the token  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.onBehalfOf | <code>string</code> | the Earthdata Login client id of the   app requesting the username |
| params.token | <code>string</code> | the Earthdata Login token |
| [params.xRequestId] | <code>string</code> | a string to help identify the request   in the Earthdata Login logs |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`

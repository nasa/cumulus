# @cumulus/oauth-client

Utilities for OAuth authentication using
[NASA Earthdata Login](https://urs.earthdata.nasa.gov/) and [AWS Cognito](https://aws.amazon.com/cognito/).

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
$ npm install @cumulus/oauth-client
```

## Class Structure

This package contains a generic, parent class called `OAuthClient`. This class has a few common methods
like `oAuthClient.getAuthorizationUrl()` which are used by all classes that inherit from `OAuthClient`.

The examples below document these common methods as well as methods specific to the child classes, e.g.
`cognitoClient.getUserInfo(accessToken)`.

## Earthdata Login Usage Example

```js
const { EarthdataLoginClient } = require('@cumulus/oauth-client');

const client = new EarthdataLoginClient({
  clientId: 'my-client-id',
  clientPassword: 'my-client-password',
  loginUrl: 'https://earthdata.login.nasa.gov',
  redirectUri: 'http://my-api.com'
});
```
## Cognito Usage Example

```js
const { CognitoClient } = require('@cumulus/oauth-client');

const client = new CognitoClient({
  clientId: 'my-client-id',
  clientPassword: 'my-client-password',
  loginUrl: 'https://auth.csdap.sit.earthdatacloud.nasa.gov/',
  redirectUri: 'http://my-api.com'
});
```

## API

## Classes

<dl>
<dt><a href="#CognitoClient">CognitoClient</a></dt>
<dd><p>A client for the Cognito API. Extents OAuthClient.</p>
</dd>
<dt><a href="#EarthdataLoginClient">EarthdataLoginClient</a></dt>
<dd><p>A client for the Earthdata Login API. Extents OAuthClient.</p>
</dd>
<dt><a href="#OAuthClient">OAuthClient</a></dt>
<dd><p>A generic authorization client</p>
</dd>
</dl>

<a name="CognitoClient"></a>

## CognitoClient
A client for the Cognito API. Extents OAuthClient.

**Kind**: global class  
<a name="CognitoClient+getUserInfo"></a>

### cognitoClient.getUserInfo(accessToken) ⇒ <code>Promise.&lt;Object&gt;</code>
Query the Cognito API for the user object associated with an access token.

**Kind**: instance method of [<code>CognitoClient</code>](#CognitoClient)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - The user object (see example)  

| Param | Type | Description |
| --- | --- | --- |
| accessToken | <code>string</code> | The Cognito access token for Authorization header |

**Example**  
```js
{
 "username": "Jane Doe",
 "given_name": "Jane",
 "family_name": "Doe",
 "study_area": "Atmospheric Composition",
 "organization": "NASA",
 "email": "janedoe@example.com"
}
```
<a name="EarthdataLoginClient"></a>

## EarthdataLoginClient
A client for the Earthdata Login API. Extents OAuthClient.

**Kind**: global class  
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

<a name="OAuthClient"></a>

## OAuthClient
A generic authorization client

**Kind**: global class  

* [OAuthClient](#OAuthClient)
    * [new OAuthClient(params)](#new_OAuthClient_new)
    * [.getAuthorizationUrl([state])](#OAuthClient+getAuthorizationUrl) ⇒ <code>string</code>
    * [.getAccessToken(authorizationCode)](#OAuthClient+getAccessToken) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.postRequest(params)](#OAuthClient+postRequest) ⇒ <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code>
    * [.getRequest(params)](#OAuthClient+getRequest) ⇒ <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code>
    * [.refreshAccessToken(refreshToken)](#OAuthClient+refreshAccessToken) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_OAuthClient_new"></a>

### new OAuthClient(params)

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.clientId | <code>string</code> | see example |
| params.clientPassword | <code>string</code> | see example |
| params.loginUrl | <code>string</code> | see example |
| params.redirectUri | <code>string</code> | see example |

**Example**  
```js
const oAuth2Provider = new OAuthClient({
  clientId: 'my-client-id',
  clientPassword: 'my-client-password',
  loginUrl: 'https://earthdata.login.nasa.gov',
  redirectUri: 'http://my-api.com'
});
```
<a name="OAuthClient+getAuthorizationUrl"></a>

### oAuthClient.getAuthorizationUrl([state]) ⇒ <code>string</code>
Get a URL of the Login authorization endpoint

**Kind**: instance method of [<code>OAuthClient</code>](#OAuthClient)  
**Returns**: <code>string</code> - the Login authorization URL  

| Param | Type | Description |
| --- | --- | --- |
| [state] | <code>string</code> | an optional state to pass to login Client |

<a name="OAuthClient+getAccessToken"></a>

### oAuthClient.getAccessToken(authorizationCode) ⇒ <code>Promise.&lt;Object&gt;</code>
Given an authorization code, request an access token and associated
information from the login service.

Returns an object with the following properties:

- accessToken
- refreshToken
- username
- expirationTime (in seconds)

**Kind**: instance method of [<code>OAuthClient</code>](#OAuthClient)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - access token information  

| Param | Type | Description |
| --- | --- | --- |
| authorizationCode | <code>string</code> | an OAuth2 authorization code |

<a name="OAuthClient+postRequest"></a>

### oAuthClient.postRequest(params) ⇒ <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code>
Make an HTTP POST request to the login service

**Kind**: instance method of [<code>OAuthClient</code>](#OAuthClient)  
**Returns**: <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code> - The return of the POST call  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.loginPath | <code>string</code> | the URL for the request |
| params.form | <code>Object</code> | the body of the POST request |
| [params.headers] | <code>Array</code> | Optional request headers |

<a name="OAuthClient+getRequest"></a>

### oAuthClient.getRequest(params) ⇒ <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code>
Make an HTTP GET request to the login service

**Kind**: instance method of [<code>OAuthClient</code>](#OAuthClient)  
**Returns**: <code>CancelableRequest.&lt;Response.&lt;unknown&gt;&gt;</code> - The return of the GET call  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.path | <code>string</code> | the URL for the request |
| params.accessToken | <code>string</code> | Auth bearer token for request |

<a name="OAuthClient+refreshAccessToken"></a>

### oAuthClient.refreshAccessToken(refreshToken) ⇒ <code>Promise.&lt;Object&gt;</code>
Given a refresh token, request an access token and associated information
from the login service.

Returns an object with the following properties:

- accessToken
- refreshToken
- username
- expirationTime (in seconds)

**Kind**: instance method of [<code>OAuthClient</code>](#OAuthClient)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - access token information  

| Param | Type | Description |
| --- | --- | --- |
| refreshToken | <code>string</code> | an OAuth2 refresh token |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please
[see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`

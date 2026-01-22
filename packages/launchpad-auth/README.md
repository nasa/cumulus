# @cumulus/launchpad-auth

Utilities for authentication by Cumulus using Launchpad.

## Usage

```bash
  npm install @cumulus/launchpad-auth
```

## API

### Modules

<dl>
<dt><a href="#module_launchpad-auth">launchpad-auth</a></dt>
<dd><p>Utility functions for generating and validating Launchpad tokens</p>
</dd>
</dl>

### Classes

<dl>
<dt><a href="#LaunchpadToken">LaunchpadToken</a></dt>
<dd><p>A class for sending requests to Launchpad token service endpoints</p>
</dd>
</dl>

<a name="module_launchpad-auth"></a>

### launchpad-auth
Utility functions for generating and validating Launchpad tokens


* [launchpad-auth](#module_launchpad-auth)
    * [getLaunchpadToken(params)](#exp_module_launchpad-auth--getLaunchpadToken) ⇒ <code>Promise.&lt;string&gt;</code> ⏏
    * [validateLaunchpadToken(params, token, [userGroup])](#exp_module_launchpad-auth--validateLaunchpadToken) ⇒ <code>Promise.&lt;ValidateTokenResult&gt;</code> ⏏

<a name="exp_module_launchpad-auth--getLaunchpadToken"></a>

#### getLaunchpadToken(params) ⇒ <code>Promise.&lt;string&gt;</code> ⏏
Get a Launchpad token

**Kind**: Exported function
**Returns**: <code>Promise.&lt;string&gt;</code> - - the Launchpad token

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | the configuration parameters for creating LaunchpadToken object |
| params.api | <code>string</code> | the Launchpad token service api endpoint |
| params.passphrase | <code>string</code> | the passphrase of the Launchpad PKI certificate |
| params.certificate | <code>string</code> | the name of the Launchpad PKI pfx certificate |

<a name="exp_module_launchpad-auth--validateLaunchpadToken"></a>

#### validateLaunchpadToken(params, token, [userGroup]) ⇒ <code>Promise.&lt;ValidateTokenResult&gt;</code> ⏏
Validate a Launchpad token

**Kind**: Exported function
**Returns**: <code>Promise.&lt;ValidateTokenResult&gt;</code> - - the validate result object with
{ status: 'success or failed', message: 'reason for failure',
session_maxtimeout: number second, session_starttime: number millisecond,
owner_auid: string}

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | the configuration parameters for creating LaunchpadToken object |
| params.api | <code>string</code> | the Launchpad token service api endpoint |
| params.passphrase | <code>string</code> | the passphrase of the Launchpad PKI certificate |
| params.certificate | <code>string</code> | the name of the Launchpad PKI pfx certificate |
| token | <code>string</code> | the token to be validated |
| [userGroup] | <code>string</code> | the cumulus user group that a valid user should belong to |

<a name="LaunchpadToken"></a>

### LaunchpadToken
A class for sending requests to Launchpad token service endpoints

**Kind**: global class

* [LaunchpadToken](#LaunchpadToken)
    * [new LaunchpadToken(params)](#new_LaunchpadToken_new)
    * [.requestToken()](#LaunchpadToken+requestToken) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.validateToken(token)](#LaunchpadToken+validateToken) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_LaunchpadToken_new"></a>

#### new LaunchpadToken(params)

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.api | <code>string</code> | the Launchpad token service api endpoint |
| params.passphrase | <code>string</code> | the passphrase of the Launchpad PKI certificate |
| params.certificate | <code>string</code> | the name of the Launchpad PKI pfx certificate |

**Example**
```js
const LaunchpadToken = require('@cumulus/launchpad-auth/LaunchpadToken');

const launchpadToken = new LaunchpadToken({
 api: 'launchpad-token-api-endpoint',
 passphrase: 'my-pki-passphrase',
 certificate: 'my-pki-certificate.pfx'
});
```
<a name="LaunchpadToken+requestToken"></a>

#### launchpadToken.requestToken() ⇒ <code>Promise.&lt;Object&gt;</code>
Get a token from Launchpad

**Kind**: instance method of [<code>LaunchpadToken</code>](#LaunchpadToken)
**Returns**: <code>Promise.&lt;Object&gt;</code> - - the Launchpad gettoken response object
<a name="LaunchpadToken+validateToken"></a>

#### launchpadToken.validateToken(token) ⇒ <code>Promise.&lt;Object&gt;</code>
Validate a Launchpad token

**Kind**: instance method of [<code>LaunchpadToken</code>](#LaunchpadToken)
**Returns**: <code>Promise.&lt;Object&gt;</code> - - the Launchpad validate token response object

| Param | Type | Description |
| --- | --- | --- |
| token | <code>string</code> | the Launchpad token for validation |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`

# API

## Classes

<dl>
<dt><a href="#CMR">CMR</a></dt>
<dd><p>A class to simplify requests to the CMR</p>
</dd>
<dt><a href="#CMRSearchConceptQueue">CMRSearchConceptQueue</a></dt>
<dd><p>A class to efficiently list all of the concepts (collections/granules) from
CMR search, without loading them all into memory at once.  Handles paging.</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#providerParams">providerParams()</a></dt>
<dd><p>Shim to correctly add a default provider_short_name to the input searchParams</p>
</dd>
</dl>

<a name="CMR"></a>

## CMR
A class to simplify requests to the CMR

**Kind**: global class

* [CMR](#CMR)
    * [new CMR()](#new_CMR_new)
    * _instance_
        * [.getCmrPassword()](#CMR+getCmrPassword) ⇒ <code>Promise.&lt;string&gt;</code>
        * [.getToken()](#CMR+getToken) ⇒ <code>Promise.&lt;(string\|undefined)&gt;</code>
        * [.checkRefreshLaunchpadToken()](#CMR+checkRefreshLaunchpadToken) ⇒ <code>Promise.&lt;void&gt;</code>
        * [.refreshLaunchpadToken()](#CMR+refreshLaunchpadToken) ⇒ <code>Promise.&lt;void&gt;</code>
        * [.withCmrLaunchpadTokenRefreshRetry(operation, [retries])](#CMR+withCmrLaunchpadTokenRefreshRetry) ⇒ <code>Promise</code>
        * [.getWriteHeaders(params)](#CMR+getWriteHeaders) ⇒ <code>Object</code>
        * [.getReadHeaders(params)](#CMR+getReadHeaders) ⇒ <code>Object</code>
        * [.ingestCollection(xml, provider)](#CMR+ingestCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.ingestGranule(xml, provider, cmrRevisionId)](#CMR+ingestGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.ingestUMMGranule(ummgMetadata, provider, cmrRevisionId)](#CMR+ingestUMMGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.deleteCollection(datasetID, provider)](#CMR+deleteCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.deleteGranule(granuleUR, provider)](#CMR+deleteGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.searchCollections(params, provider, [format])](#CMR+searchCollections) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.searchGranules(params, provider, [format])](#CMR+searchGranules) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.getGranuleMetadata(cmrLink)](#CMR+getGranuleMetadata) ⇒ <code>Object</code>
    * _static_
        * [.getInstance()](#CMR.getInstance) ⇒ [<code>CMR</code>](#CMR)
        * [.resetInstance()](#CMR.resetInstance)

<a name="new_CMR_new"></a>

### new CMR()
The constructor for the CMR class

**Example**
```js
const { CMR } = require('@cumulus/cmr-client');

const cmrClient = new CMR({
 provider: 'my-provider',
 clientId: 'my-clientId',
 username: 'my-username',
 password: 'my-password'
});

or

const cmrClient = new CMR({
 provider: 'my-provider',
 clientId: 'my-clientId',
 token: 'cmr_or_launchpad_token'
});
TODO: this should be subclassed or refactored to a functional style
due to branch logic/complexity in token vs password/username handling
```
<a name="CMR+getCmrPassword"></a>

### cmrClient.getCmrPassword() ⇒ <code>Promise.&lt;string&gt;</code>
Get the CMR password, from the AWS secret if set, else return the password

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;string&gt;</code> - - the CMR password
<a name="CMR+getToken"></a>

### cmrClient.getToken() ⇒ <code>Promise.&lt;(string\|undefined)&gt;</code>
The method for getting the token

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;(string\|undefined)&gt;</code> - the token
<a name="CMR+checkRefreshLaunchpadToken"></a>

### cmrClient.checkRefreshLaunchpadToken() ⇒ <code>Promise.&lt;void&gt;</code>
Checks if a process calling the cmrClient is in the middle of creating a new launchpad token.
This function is called when a 401 launchpad auth error is encountered when using a launchpad
token for cmr calls. It calls refreshLaunchpadToken and stores the refreshPromise
so other calls that want to get a launchpad token know that a process is already doing that.

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;void&gt;</code> - refresh promise
<a name="CMR+refreshLaunchpadToken"></a>

### cmrClient.refreshLaunchpadToken() ⇒ <code>Promise.&lt;void&gt;</code>
Refreshes the launchpad token due to authentication failures with launchpad. This function
calls getValidLaunchpadToken which creates a lock file in S3 at the token's location, to tell
other processes that a token recreation is in progress, fetches a new token from launchpad,
stores it as a part of the CMR singleton class, and then uses that one for calls

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;void&gt;</code> - refresh promise
<a name="CMR+withCmrLaunchpadTokenRefreshRetry"></a>

### cmrClient.withCmrLaunchpadTokenRefreshRetry(operation, [retries]) ⇒ <code>Promise</code>
Runs a CMR operation with retry logic for launchpad failures. If the operation fails with a
401, refresh the Launchpad token and retry.

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise</code> - - result of CMR function call

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| operation | <code>function</code> |  | the CMR function with args to execute |
| [retries] | <code>number</code> | <code>5</code> | number of retry attempts on 401 |

<a name="CMR+getWriteHeaders"></a>

### cmrClient.getWriteHeaders(params) ⇒ <code>Object</code>
Return object containing CMR request headers for PUT / POST / DELETE

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Object</code> - CMR headers object

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| [params.token] | <code>string</code> | CMR request token |
| [params.ummgVersion] | <code>string</code> | UMMG metadata version string or null if echo10 metadata |
| [params.cmrRevisionId] | <code>string</code> | CMR Revision ID |

<a name="CMR+getReadHeaders"></a>

### cmrClient.getReadHeaders(params) ⇒ <code>Object</code>
Return object containing CMR request headers for GETs

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Object</code> - CMR headers object

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| [params.token] | <code>string</code> | CMR request token |

<a name="CMR+ingestCollection"></a>

### cmrClient.ingestCollection(xml, provider) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a collection record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the collection XML document |
| provider | <code>string</code> | the CMR provider to target |

<a name="CMR+ingestGranule"></a>

### cmrClient.ingestGranule(xml, provider, cmrRevisionId) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a granule record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the granule XML document |
| provider | <code>string</code> | the CMR provider to target |
| cmrRevisionId | <code>string</code> | Optional CMR Revision ID |

<a name="CMR+ingestUMMGranule"></a>

### cmrClient.ingestUMMGranule(ummgMetadata, provider, cmrRevisionId) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds/Updates UMMG json metadata in the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - to the CMR response object.

| Param | Type | Description |
| --- | --- | --- |
| ummgMetadata | <code>Object</code> | UMMG metadata object |
| provider | <code>string</code> | the CMR provider to target |
| cmrRevisionId | <code>string</code> | Optional CMR Revision ID |

<a name="CMR+deleteCollection"></a>

### cmrClient.deleteCollection(datasetID, provider) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a collection record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Description |
| --- | --- | --- |
| datasetID | <code>string</code> | the collection unique id |
| provider | <code>string</code> | the CMR provider to target |

<a name="CMR+deleteGranule"></a>

### cmrClient.deleteGranule(granuleUR, provider) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a granule record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Description |
| --- | --- | --- |
| granuleUR | <code>string</code> | the granule unique id |
| provider | <code>string</code> | the CMR provider to target |

<a name="CMR+searchCollections"></a>

### cmrClient.searchCollections(params, provider, [format]) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in collections

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>string</code> |  | the search parameters |
| provider | <code>string</code> |  | the CMR provider to target |
| [format] | <code>string</code> | <code>&quot;json&quot;</code> | format of the response |

<a name="CMR+searchGranules"></a>

### cmrClient.searchGranules(params, provider, [format]) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in granules

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>string</code> |  | the search parameters |
| provider | <code>string</code> |  | the CMR provider to target |
| [format] | <code>string</code> | <code>&quot;&#x27;json&#x27;&quot;</code> | format of the response |

<a name="CMR+getGranuleMetadata"></a>

### cmrClient.getGranuleMetadata(cmrLink) ⇒ <code>Object</code>
Get the granule metadata from CMR using the cmrLink

**Kind**: instance method of [<code>CMR</code>](#CMR)
**Returns**: <code>Object</code> - - metadata as a JS object, null if not found

| Param | Type | Description |
| --- | --- | --- |
| cmrLink | <code>string</code> | URL to concept |

<a name="CMR.getInstance"></a>

### CMR.getInstance() ⇒ [<code>CMR</code>](#CMR)
Creates a new CMR singleton instance of one does not already exist,
if one does, returns it

**Kind**: static method of [<code>CMR</code>](#CMR)
**Returns**: [<code>CMR</code>](#CMR) - - the existing or newly made CMR instance
<a name="CMR.resetInstance"></a>

### CMR.resetInstance()
Resets the CMR singleton instance to undefined, only used for testing with
suites that create multiple instances in sequence.

**Kind**: static method of [<code>CMR</code>](#CMR)
<a name="CMRSearchConceptQueue"></a>

## CMRSearchConceptQueue
A class to efficiently list all of the concepts (collections/granules) from
CMR search, without loading them all into memory at once.  Handles paging.

**Kind**: global class

* [CMRSearchConceptQueue](#CMRSearchConceptQueue)
    * [new CMRSearchConceptQueue(params)](#new_CMRSearchConceptQueue_new)
    * [.peek()](#CMRSearchConceptQueue+peek)
    * [.shift()](#CMRSearchConceptQueue+shift)

<a name="new_CMRSearchConceptQueue_new"></a>

### new CMRSearchConceptQueue(params)
The constructor for the CMRSearchConceptQueue class


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.cmrSettings | <code>Object</code> |  | the CMR settings for the requests - the provider, clientId, and either launchpad token or EDL username and password |
| params.type | <code>string</code> |  | the type of search 'granule' or 'collection' |
| [params.searchParams] | <code>URLSearchParams</code> | <code>{}</code> | the search parameters |
| params.format | <code>string</code> |  | the result format |

**Example**
```js
const { CMRSearchConceptQueue } = require('@cumulus/cmr-client');

const cmrSearchConceptQueue = new CMRSearchConceptQueue({
  provider: 'my-provider',
  clientId: 'my-clientId',
  type: 'granule',
  searchParams: {},
  format: 'json'
});
```
<a name="CMRSearchConceptQueue+peek"></a>

### cmrSearchConceptQueue.peek()
View the next item in the queue

This does not remove the object from the queue.  When there are no more
items in the queue, returns 'null'.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)
<a name="CMRSearchConceptQueue+shift"></a>

### cmrSearchConceptQueue.shift()
Remove the next item from the queue

When there are no more items in the queue, returns `null`.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)
<a name="providerParams"></a>

## providerParams()
Shim to correctly add a default provider_short_name to the input searchParams

**Kind**: global function

---

Generated automatically using `npm run build-docs`

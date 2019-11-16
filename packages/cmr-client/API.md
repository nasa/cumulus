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

<a name="CMR"></a>

## CMR
A class to simplify requests to the CMR

**Kind**: global class  

* [CMR](#CMR)
    * [new CMR(params)](#new_CMR_new)
    * [.getToken()](#CMR+getToken) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.getHeaders(params)](#CMR+getHeaders) ⇒ <code>Object</code>
    * [.ingestCollection(xml)](#CMR+ingestCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestGranule(xml)](#CMR+ingestGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestUMMGranule(ummgMetadata)](#CMR+ingestUMMGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteCollection(datasetID)](#CMR+deleteCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteGranule(granuleUR)](#CMR+deleteGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchCollections(params, [format])](#CMR+searchCollections) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchGranules(params, [format])](#CMR+searchGranules) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMR_new"></a>

### new CMR(params)
The constructor for the CMR class


| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.provider | <code>string</code> | the CMR provider id |
| params.clientId | <code>string</code> | the CMR clientId |
| params.username | <code>string</code> | CMR username, not used if token is provided |
| params.password | <code>string</code> | CMR password, not used if token is provided |
| params.token | <code>string</code> | CMR or Launchpad token, if not provided, CMR username and password are used to get a cmr token |

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
```
<a name="CMR+getToken"></a>

### cmrClient.getToken() ⇒ <code>Promise.&lt;string&gt;</code>
The method for getting the token

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the token  
<a name="CMR+getHeaders"></a>

### cmrClient.getHeaders(params) ⇒ <code>Object</code>
Return object containing CMR request headers

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Object</code> - CMR headers object  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| [params.token] | <code>string</code> | CMR request token |
| [params.ummgVersion] | <code>string</code> | UMMG metadata version string or null if echo10 metadata |

<a name="CMR+ingestCollection"></a>

### cmrClient.ingestCollection(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a collection record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the collection XML document |

<a name="CMR+ingestGranule"></a>

### cmrClient.ingestGranule(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a granule record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the granule XML document |

<a name="CMR+ingestUMMGranule"></a>

### cmrClient.ingestUMMGranule(ummgMetadata) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds/Updates UMMG json metadata in the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - to the CMR response object.  

| Param | Type | Description |
| --- | --- | --- |
| ummgMetadata | <code>Object</code> | UMMG metadata object |

<a name="CMR+deleteCollection"></a>

### cmrClient.deleteCollection(datasetID) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a collection record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| datasetID | <code>string</code> | the collection unique id |

<a name="CMR+deleteGranule"></a>

### cmrClient.deleteGranule(granuleUR) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a granule record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| granuleUR | <code>string</code> | the granule unique id |

<a name="CMR+searchCollections"></a>

### cmrClient.searchCollections(params, [format]) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in collections

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>string</code> |  | the search parameters |
| [format] | <code>string</code> | <code>&quot;json&quot;</code> | format of the response |

<a name="CMR+searchGranules"></a>

### cmrClient.searchGranules(params, [format]) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in granules

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>string</code> |  | the search parameters |
| [format] | <code>string</code> | <code>&quot;&#x27;json&#x27;&quot;</code> | format of the response |

<a name="CMRSearchConceptQueue"></a>

## CMRSearchConceptQueue
A class to efficiently list all of the concepts (collections/granules) from
CMR search, without loading them all into memory at once.  Handles paging.

**Kind**: global class  

* [CMRSearchConceptQueue](#CMRSearchConceptQueue)
    * [new CMRSearchConceptQueue(params)](#new_CMRSearchConceptQueue_new)
    * [.peek()](#CMRSearchConceptQueue+peek) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.shift()](#CMRSearchConceptQueue+shift) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMRSearchConceptQueue_new"></a>

### new CMRSearchConceptQueue(params)
The constructor for the CMRSearchConceptQueue class


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.provider | <code>string</code> |  | the CMR provider id |
| params.clientId | <code>string</code> |  | the CMR clientId |
| params.type | <code>string</code> |  | the type of search 'granule' or 'collection' |
| [params.searchParams] | <code>string</code> | <code>&quot;{}&quot;</code> | the search parameters |
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

### cmrSearchConceptQueue.peek() ⇒ <code>Promise.&lt;Object&gt;</code>
View the next item in the queue

This does not remove the object from the queue.  When there are no more
items in the queue, returns 'null'.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an item from the CMR search  
<a name="CMRSearchConceptQueue+shift"></a>

### cmrSearchConceptQueue.shift() ⇒ <code>Promise.&lt;Object&gt;</code>
Remove the next item from the queue

When there are no more items in the queue, returns `null`.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - an item from the CMR search  

---

Generated automatically using `npm run build-docs`

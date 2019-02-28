# @cumulus/cmr-client API Documentation

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
    * [new CMR(provider, clientId, username, password)](#new_CMR_new)
    * [.getToken()](#CMR+getToken) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.getHeaders([token], [ummgVersion])](#CMR+getHeaders) ⇒ <code>Object</code>
    * [.ingestCollection(xml)](#CMR+ingestCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestGranule(xml)](#CMR+ingestGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestUMMGranule(ummgMetadata)](#CMR+ingestUMMGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteCollection(datasetID)](#CMR+deleteCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteGranule(granuleUR)](#CMR+deleteGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchCollections(searchParams, format)](#CMR+searchCollections) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchGranules(searchParams, format)](#CMR+searchGranules) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMR_new"></a>

### new CMR(provider, clientId, username, password)
The constructor for the CMR class


| Param | Type | Description |
| --- | --- | --- |
| provider | <code>string</code> | the CMR provider id |
| clientId | <code>string</code> | the CMR clientId |
| username | <code>string</code> | CMR username |
| password | <code>string</code> | CMR password |

**Example**  
```js
const { CMR } = require('@cumulus/cmr-client');

const cmrClient = new CMR('my-provider', 'my-clientId', 'my-username', 'my-password');
```
<a name="CMR+getToken"></a>

### cmrClient.getToken() ⇒ <code>Promise.&lt;string&gt;</code>
The method for getting the token

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the token  
<a name="CMR+getHeaders"></a>

### cmrClient.getHeaders([token], [ummgVersion]) ⇒ <code>Object</code>
Return object containing CMR request headers

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Object</code> - CMR headers object  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [token] | <code>string</code> | <code>null</code> | CMR request token |
| [ummgVersion] | <code>string</code> | <code>null</code> | UMMG metadata version string or null if echo10 metadata |

<a name="CMR+ingestCollection"></a>

### cmrClient.ingestCollection(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a collection record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the collection xml document |

<a name="CMR+ingestGranule"></a>

### cmrClient.ingestGranule(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a granule record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the granule xml document |

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

### cmrClient.searchCollections(searchParams, format) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in collections

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| searchParams | <code>string</code> | the search parameters |
| searchParams.provider_short_name | <code>string</code> | provider shortname |
| format | <code>string</code> | format of the response |

<a name="CMR+searchGranules"></a>

### cmrClient.searchGranules(searchParams, format) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in granules

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| searchParams | <code>string</code> | the search parameters |
| searchParams.provider_short_name | <code>string</code> | provider shortname |
| format | <code>string</code> | format of the response |

<a name="CMRSearchConceptQueue"></a>

## CMRSearchConceptQueue
A class to efficiently list all of the concepts (collections/granules) from
CMR search, without loading them all into memory at once.  Handles paging.

**Kind**: global class  

* [CMRSearchConceptQueue](#CMRSearchConceptQueue)
    * [new CMRSearchConceptQueue(provider, clientId, type, params, format)](#new_CMRSearchConceptQueue_new)
    * [.peek()](#CMRSearchConceptQueue+peek) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.shift()](#CMRSearchConceptQueue+shift) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMRSearchConceptQueue_new"></a>

### new CMRSearchConceptQueue(provider, clientId, type, params, format)
The constructor for the CMRSearchConceptQueue class


| Param | Type | Description |
| --- | --- | --- |
| provider | <code>string</code> | the CMR provider id |
| clientId | <code>string</code> | the CMR clientId |
| type | <code>string</code> | the type of search 'granule' or 'collection' |
| params | <code>string</code> | the search parameters |
| format | <code>string</code> | the result format |

**Example**  
```js
const { CMRSearchConceptQueue } = require('@cumulus/cmr-client');

const cmrSearchConceptQueue = new CMRSearchConceptQueue(
  'my-provider',
  'my-clientId',
  'granule',
  {},
  'json'
);
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

# @cumulus/cmr-client

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

A Node.js client to read from, write to, and delete from NASA's Common Metadata Repository (CMR) API.

## API

### Classes

<dl>
<dt><a href="#CMR">CMR</a></dt>
<dd><p>The CMR class</p>
</dd>
<dt><a href="#CMRSearchConceptQueue">CMRSearchConceptQueue</a></dt>
<dd></dd>
</dl>

### Functions

<dl>
<dt><a href="#ummVersion">ummVersion(umm)</a> ⇒ <code>string</code></dt>
<dd><p>Find the UMM version as a decimal string.
If a version cannot be found on the input object
version 1.4 is assumed and returned.</p>
</dd>
<dt><a href="#validateUMMG">validateUMMG(ummMetadata, identifier, provider)</a> ⇒ <code>Promise.&lt;boolean&gt;</code></dt>
<dd><p>Posts a given xml string to the validate endpoint of CMR
and promises true of valid.</p>
</dd>
<dt><a href="#updateToken">updateToken(cmrProvider, clientId, username, password)</a> ⇒ <code>Promise.&lt;string&gt;</code></dt>
<dd><p>Returns a valid a CMR token</p>
</dd>
</dl>

<a name="CMR"></a>

### CMR
The CMR class

**Kind**: global class  

* [CMR](#CMR)
    * [new CMR(provider, clientId, username, password)](#new_CMR_new)
    * [.getToken()](#CMR+getToken) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.getHeaders([token], ummgVersion)](#CMR+getHeaders) ⇒ <code>Object</code>
    * [.ingestCollection(xml)](#CMR+ingestCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestGranule(xml)](#CMR+ingestGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.ingestUMMGranule(ummgMetadata)](#CMR+ingestUMMGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteCollection(datasetID)](#CMR+deleteCollection) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.deleteGranule(granuleUR)](#CMR+deleteGranule) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchCollections(searchParams, format)](#CMR+searchCollections) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.searchGranules(searchParams, format)](#CMR+searchGranules) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMR_new"></a>

#### new CMR(provider, clientId, username, password)
The constructor for the CMR class


| Param | Type | Description |
| --- | --- | --- |
| provider | <code>string</code> | the CMR provider id |
| clientId | <code>string</code> | the CMR clientId |
| username | <code>string</code> | CMR username |
| password | <code>string</code> | CMR password |

<a name="CMR+getToken"></a>

#### cmR.getToken() ⇒ <code>Promise.&lt;string&gt;</code>
The method for getting the token

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;string&gt;</code> - the token  
<a name="CMR+getHeaders"></a>

#### cmR.getHeaders([token], ummgVersion) ⇒ <code>Object</code>
Return object containing CMR request headers

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Object</code> - CMR headers object  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [token] | <code>string</code> | <code>null</code> | CMR request token |
| ummgVersion | <code>string</code> | <code>null</code> | UMMG metadata version string or null if echo10 metadata |

<a name="CMR+ingestCollection"></a>

#### cmR.ingestCollection(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a collection record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the collection xml document |

<a name="CMR+ingestGranule"></a>

#### cmR.ingestGranule(xml) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds a granule record to the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| xml | <code>string</code> | the granule xml document |

<a name="CMR+ingestUMMGranule"></a>

#### cmR.ingestUMMGranule(ummgMetadata) ⇒ <code>Promise.&lt;Object&gt;</code>
Adds/Updates UMMG json metadata in the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - to the CMR response object.  

| Param | Type | Description |
| --- | --- | --- |
| ummgMetadata | <code>Object</code> | UMMG metadata object |

<a name="CMR+deleteCollection"></a>

#### cmR.deleteCollection(datasetID) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a collection record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| datasetID | <code>string</code> | the collection unique id |

<a name="CMR+deleteGranule"></a>

#### cmR.deleteGranule(granuleUR) ⇒ <code>Promise.&lt;Object&gt;</code>
Deletes a granule record from the CMR

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| granuleUR | <code>string</code> | the granule unique id |

<a name="CMR+searchCollections"></a>

#### cmR.searchCollections(searchParams, format) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in collections

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| searchParams | <code>string</code> | the search parameters |
| searchParams.provider_short_name | <code>string</code> | provider shortname |
| format | <code>string</code> | format of the response |

<a name="CMR+searchGranules"></a>

#### cmR.searchGranules(searchParams, format) ⇒ <code>Promise.&lt;Object&gt;</code>
Search in granules

**Kind**: instance method of [<code>CMR</code>](#CMR)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - the CMR response  

| Param | Type | Description |
| --- | --- | --- |
| searchParams | <code>string</code> | the search parameters |
| searchParams.provider_short_name | <code>string</code> | provider shortname |
| format | <code>string</code> | format of the response |

<a name="CMRSearchConceptQueue"></a>

### CMRSearchConceptQueue
**Kind**: global class  

* [CMRSearchConceptQueue](#CMRSearchConceptQueue)
    * [new CMRSearchConceptQueue(provider, clientId, type, params, format)](#new_CMRSearchConceptQueue_new)
    * [.peek()](#CMRSearchConceptQueue+peek) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.shift()](#CMRSearchConceptQueue+shift) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="new_CMRSearchConceptQueue_new"></a>

#### new CMRSearchConceptQueue(provider, clientId, type, params, format)
The constructor for the CMRSearchConceptQueue class


| Param | Type | Description |
| --- | --- | --- |
| provider | <code>string</code> | the CMR provider id |
| clientId | <code>string</code> | the CMR clientId |
| type | <code>string</code> | the type of search 'granule' or 'collection' |
| params | <code>string</code> | the search parameters |
| format | <code>string</code> | the result format |

<a name="CMRSearchConceptQueue+peek"></a>

#### cmrSearchConceptQueue.peek() ⇒ <code>Promise.&lt;Object&gt;</code>
View the next item in the queue

This does not remove the object from the queue.  When there are no more
items in the queue, returns 'null'.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - an item from the CMR search  
<a name="CMRSearchConceptQueue+shift"></a>

#### cmrSearchConceptQueue.shift() ⇒ <code>Promise.&lt;Object&gt;</code>
Remove the next item from the queue

When there are no more items in the queue, returns 'null'.

**Kind**: instance method of [<code>CMRSearchConceptQueue</code>](#CMRSearchConceptQueue)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - - an item from the CMR search  
<a name="ummVersion"></a>

### ummVersion(umm) ⇒ <code>string</code>
Find the UMM version as a decimal string.
If a version cannot be found on the input object
version 1.4 is assumed and returned.

**Kind**: global function  
**Returns**: <code>string</code> - UMM version for the given object  

| Param | Type | Description |
| --- | --- | --- |
| umm | <code>Object</code> | UMM metadata object |

<a name="validateUMMG"></a>

### validateUMMG(ummMetadata, identifier, provider) ⇒ <code>Promise.&lt;boolean&gt;</code>
Posts a given xml string to the validate endpoint of CMR
and promises true of valid.

**Kind**: global function  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - returns true if the document is valid  

| Param | Type | Description |
| --- | --- | --- |
| ummMetadata | <code>string</code> | the UMM object |
| identifier | <code>string</code> | the document identifier |
| provider | <code>string</code> | the CMR provider |

<a name="updateToken"></a>

### updateToken(cmrProvider, clientId, username, password) ⇒ <code>Promise.&lt;string&gt;</code>
Returns a valid a CMR token

**Kind**: global function  
**Returns**: <code>Promise.&lt;string&gt;</code> - the token  

| Param | Type | Description |
| --- | --- | --- |
| cmrProvider | <code>string</code> | the CMR provider id |
| clientId | <code>string</code> | the CMR clientId |
| username | <code>string</code> | CMR username |
| password | <code>string</code> | CMR password |


## CMR Docs

CMR REST API endpoint documentation is here:

- https://cmr.earthdata.nasa.gov/search/site/search_api_docs.html
- https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Test

Test with `npm run test`.


## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)

---

Generated automatically using `npm run build-docs`

# @cumulus/integration-tests

This package provides a CLI and functions for testing Cumulus.

⚠️ The [documented API](#api) of this package will not change without a
deprecation warning being provided in earlier releases. Code in this package
that is _not_ documented in this README may change without warning, and is not
considered part of the package's public API.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Installation

```sh
$ npm install @cumulus/integration-tests
```

## API

## Modules

<dl>
<dt><a href="#module_Collections">Collections</a></dt>
<dd></dd>
<dt><a href="#module_Executions">Executions</a></dt>
<dd></dd>
<dt><a href="#module_Granules">Granules</a></dt>
<dd></dd>
<dt><a href="#module_Providers">Providers</a></dt>
<dd></dd>
<dt><a href="#module_Rules">Rules</a></dt>
<dd></dd>
</dl>

<a name="module_Collections"></a>

## Collections
**Example**
```js
const Collections = require('@cumulus/integration-test/Collections');
```

* [Collections](#module_Collections)
    * [createCollection(prefix, [overrides])](#exp_module_Collections--createCollection) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
        * [~addCustomUrlPathToCollectionFiles(collection, customFilePath)](#module_Collections--createCollection..addCustomUrlPathToCollectionFiles) ⇒ <code>Array.&lt;Object&gt;</code>
        * [~buildCollection(params)](#module_Collections--createCollection..buildCollection) ⇒ <code>Object</code>
        * [~collectionExists(stackName, collection)](#module_Collections--createCollection..collectionExists) ⇒ <code>boolean</code>
        * [~addCollection(stackName, collection)](#module_Collections--createCollection..addCollection) ⇒ <code>Promise.&lt;undefined&gt;</code>
        * [~addCollections(stackName, bucketName, dataDirectory, [postfix], [customFilePath], [duplicateHandling])](#module_Collections--createCollection..addCollections) ⇒ <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code>

<a name="exp_module_Collections--createCollection"></a>

### createCollection(prefix, [overrides]) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Create a randomized collection using the Cumulus API.

The default collection is very simple. It expects that, for any discovered file, the granule ID
is everything in the filename before the extension. For example, a file named `gran-1.txt` would
have a granuleId of `gran-1`. Filenames can only contain a single `.` character.

**Collection defaults:**

- **name**: random string starting with `collection-name-`
- **version**: random string starting with `collection-version-`
- **reportToEms**: `false`
- **granuleId**: `'^[^.]+$'`
- **granuleIdExtraction**: `'^([^.]+)\..+$'`
- **sampleFileName**: `'asdf.jpg'`
- **files**:
  ```js
  [
    {
      bucket: 'protected',
      regex: '^[^.]+\..+$',
      sampleFileName: 'asdf.jpg'
    }
  ]
  ```

**Kind**: Exported function
**Returns**: <code>Promise.&lt;Object&gt;</code> - the generated collection

| Param | Type | Description |
| --- | --- | --- |
| prefix | <code>string</code> | the Cumulus stack name |
| [overrides] | <code>Object</code> | properties to set on the collection, overriding the defaults |

<a name="module_Collections--createCollection..addCustomUrlPathToCollectionFiles"></a>

#### createCollection~addCustomUrlPathToCollectionFiles(collection, customFilePath) ⇒ <code>Array.&lt;Object&gt;</code>
Given a Cumulus collection configuration, return a list of the filetype
configs with their `url_path`s updated.

**Kind**: inner method of [<code>createCollection</code>](#exp_module_Collections--createCollection)
**Returns**: <code>Array.&lt;Object&gt;</code> - a list of collection filetype configs

| Param | Type | Description |
| --- | --- | --- |
| collection | <code>Object</code> | a Cumulus collection |
| customFilePath | <code>string</code> | path to be added to the end of the url_path |

<a name="module_Collections--createCollection..buildCollection"></a>

#### createCollection~buildCollection(params) ⇒ <code>Object</code>
Update a collection with a custom file path, duplicate handling, and name
updated with the postfix.

**Kind**: inner method of [<code>createCollection</code>](#exp_module_Collections--createCollection)
**Returns**: <code>Object</code> - an updated collection

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.collection | <code>Object</code> | a collection configuration |
| params.customFilePath | <code>string</code> | path to be added to the end of the   url_path |
| params.duplicateHandling | <code>string</code> | duplicate handling setting |
| params.postfix | <code>string</code> | a string to be appended to the end of the   name |

<a name="module_Collections--createCollection..collectionExists"></a>

#### createCollection~collectionExists(stackName, collection) ⇒ <code>boolean</code>
Returns true if collection exists. False otherwise.

**Kind**: inner method of [<code>createCollection</code>](#exp_module_Collections--createCollection)

| Param | Type | Description |
| --- | --- | --- |
| stackName | <code>string</code> | the prefix of the Cumulus stack |
| collection | <code>Object</code> | a Cumulus collection |

<a name="module_Collections--createCollection..addCollection"></a>

#### createCollection~addCollection(stackName, collection) ⇒ <code>Promise.&lt;undefined&gt;</code>
Add a new collection to Cumulus

**Kind**: inner method of [<code>createCollection</code>](#exp_module_Collections--createCollection)

| Param | Type | Description |
| --- | --- | --- |
| stackName | <code>string</code> | the prefix of the Cumulus stack |
| collection | <code>Object</code> | a Cumulus collection |

<a name="module_Collections--createCollection..addCollections"></a>

#### createCollection~addCollections(stackName, bucketName, dataDirectory, [postfix], [customFilePath], [duplicateHandling]) ⇒ <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code>
Add collections to database

**Kind**: inner method of [<code>createCollection</code>](#exp_module_Collections--createCollection)
**Returns**: <code>Promise.&lt;Array.&lt;Object&gt;&gt;</code> - - collections that were added

| Param | Type | Description |
| --- | --- | --- |
| stackName | <code>string</code> | Cloud formation stack name |
| bucketName | <code>string</code> | S3 internal bucket name |
| dataDirectory | <code>string</code> | the directory of collection json files |
| [postfix] | <code>string</code> | string to append to collection name |
| [customFilePath] | <code>string</code> |  |
| [duplicateHandling] | <code>string</code> |  |

<a name="module_Executions"></a>

## Executions
**Example**
```js
const Executions = require('@cumulus/integration-test/Executions');
```

* [Executions](#module_Executions)
    * [findExecutionArn(prefix, matcher, [queryParameters], [options])](#exp_module_Executions--findExecutionArn) ⇒ <code>Promise.&lt;string&gt;</code> ⏏
    * [getExecutionWithStatus(params)](#exp_module_Executions--getExecutionWithStatus) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏

<a name="exp_module_Executions--findExecutionArn"></a>

### findExecutionArn(prefix, matcher, [queryParameters], [options]) ⇒ <code>Promise.&lt;string&gt;</code> ⏏
Find the execution ARN matching the `matcher` function

**Kind**: Exported function
**Returns**: <code>Promise.&lt;string&gt;</code> - the ARN of the matching execution

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| prefix | <code>string</code> |  | the name of the Cumulus stack |
| matcher | <code>function</code> |  | a predicate function that takes an execution and determines if this is the execution that is being searched for |
| [queryParameters] | <code>Object</code> |  | Optional query parameters |
| [options] | <code>Object</code> |  |  |
| [options.timeout] | <code>integer</code> | <code>0</code> | the number of seconds to wait for a matching execution to be found |

<a name="exp_module_Executions--getExecutionWithStatus"></a>

### getExecutionWithStatus(params) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Wait for an execution to have an expected status and return the execution

**Kind**: Exported function
**Returns**: <code>Promise.&lt;Object&gt;</code> - the execution as returned by the `GET /executions/<execution-arn>`
endpoint

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.prefix | <code>string</code> |  | the name of the Cumulus stack |
| params.arn | <code>string</code> |  | the execution ARN to fetch |
| params.status | <code>string</code> |  | the status to wait for |
| [params.callback] | <code>function</code> | <code>cumulusApiClient.invokeApifunction</code> | an async function to invoke the API Lambda that takes a prefix / user payload |
| [params.timeout] | <code>integer</code> | <code>30</code> | the number of seconds to wait for the   execution to reach a terminal state |

<a name="module_Granules"></a>

## Granules
**Example**
```js
const Granules = require('@cumulus/integration-test/Granules');
```

* [Granules](#module_Granules)
    * [getGranuleWithStatus(params)](#exp_module_Granules--getGranuleWithStatus) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
        * [~waitForListGranulesResult(params)](#module_Granules--getGranuleWithStatus..waitForListGranulesResult) ⇒ <code>Promise.&lt;Object&gt;</code>

<a name="exp_module_Granules--getGranuleWithStatus"></a>

### getGranuleWithStatus(params) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Wait for a granule to have an expected status and return the granule

**Kind**: Exported function
**Returns**: <code>Promise.&lt;Object&gt;</code> - the granule as returned by the `GET /granules/<granule-id>` endpoint

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  |  |
| params.prefix | <code>string</code> |  | the name of the Cumulus stack |
| params.granuleId | <code>string</code> |  | the `granuleId` of the granule |
| params.collectionId | <code>string</code> |  | the `collectionId` of the granule |
| params.status | <code>string</code> |  | the status to wait for |
| params.updatedAt | <code>string</code> |  | minimum updatedAt time the granule must have to return |
| [params.callback] | <code>function</code> | <code>cumulusApiClient.invokeApifunction</code> | an async function to invoke the API Lambda that takes a prefix / user payload |
| [params.timeout] | <code>integer</code> | <code>30</code> | the number of seconds to wait for the   execution to reach a terminal state |

<a name="module_Granules--getGranuleWithStatus..waitForListGranulesResult"></a>

#### getGranuleWithStatus~waitForListGranulesResult(params) ⇒ <code>Promise.&lt;Object&gt;</code>
Wait for listGranules to return at least a single value before returning an
empty result

**Kind**: inner method of [<code>getGranuleWithStatus</code>](#exp_module_Granules--getGranuleWithStatus)
**Returns**: <code>Promise.&lt;Object&gt;</code> - - results of a successful listGranules

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | parameters to listGranules function |

<a name="module_Providers"></a>

## Providers
**Example**
```js
const Providers = require('@cumulus/integration-test/Providers');
```
<a name="exp_module_Providers--createProvider"></a>

### createProvider(prefix, [overrides]) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Create a provider using the Cumulus API

**Provider defaults:**

- **id**: random string starting with `provider-`
- **protocol**: `s3`
- **globalConnectionLimit**: `10`

**Kind**: Exported function
**Returns**: <code>Promise.&lt;Object&gt;</code> - the generated provider

| Param | Type | Description |
| --- | --- | --- |
| prefix | <code>string</code> | the Cumulus stack name |
| [overrides] | <code>Object</code> | properties to set on the provider, overriding the defaults |

<a name="module_Rules"></a>

## Rules
**Example**
```js
const Rules = require('@cumulus/integration-test/Rules');
```
<a name="exp_module_Rules--createOneTimeRule"></a>

### createOneTimeRule(prefix, [overrides]) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Create a `onetime` rule using the Cumulus API

**Rule defaults:**

- **name**: random string starting with `rule_`
- **rule**: `{ type: 'onetime' }`

**Kind**: Exported function
**Returns**: <code>Promise.&lt;Object&gt;</code> - the generated rule

| Param | Type | Description |
| --- | --- | --- |
| prefix | <code>string</code> | the name of the Cumulus stack |
| [overrides] | <code>Object</code> | properties to set on the rule, overriding the defaults |


## CLI Usage

```bash
Usage: cumulus-test TYPE COMMAND [options]


  Options:

    -V, --version                   output the version number
    -s, --stack-name <stackName>    AWS Cloud Formation stack name (default: null)
    -b, --bucket-name <bucketName>  AWS S3 internal bucket name (default: null)
    -w, --workflow <workflow>       Workflow name (default: null)
    -i, --input-file <inputFile>    Workflow input JSON file (default: null)
    -h, --help                      output usage information


  Commands:

    workflow  Execute a workflow and determine if the workflow completes successfully
```

For example, to test the HelloWorld workflow:

`cumulus-test workflow --stack-name helloworld-cumulus --bucket-name cumulus-bucket-internal --workflow HelloWorldWorkflow --input-file ./helloWorldInput.json`

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`

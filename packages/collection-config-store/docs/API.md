# @cumulus/collection-config-store API Documentation

<a name="module_collection-config-store"></a>

## collection-config-store
Utilities for storing and retrieving collection config in S3


* [collection-config-store](#module_collection-config-store)
    * [CollectionConfigStore](#exp_module_collection-config-store--CollectionConfigStore) ⏏
        * [new CollectionConfigStore(bucket, stackName)](#new_module_collection-config-store--CollectionConfigStore_new)
        * [.get(name, version)](#module_collection-config-store--CollectionConfigStore+get) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.put(name, version, config)](#module_collection-config-store--CollectionConfigStore+put) ⇒ <code>Promise.&lt;null&gt;</code>
        * [.delete(name, version)](#module_collection-config-store--CollectionConfigStore+delete) ⇒ <code>Promise.&lt;null&gt;</code>

<a name="exp_module_collection-config-store--CollectionConfigStore"></a>

### CollectionConfigStore ⏏
Store and retrieve collection configs in S3

**Kind**: Exported class
<a name="new_module_collection-config-store--CollectionConfigStore_new"></a>

#### new CollectionConfigStore(bucket, stackName)
Initialize a CollectionConfigStore instance


| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>string</code> | the bucket where collection configs are stored |
| stackName | <code>string</code> | the Cumulus deployment stack name |

**Example**
```js
const CollectionConfigStore = require('@cumulus/collection-config-store');

const collectionConfigStore = new CollectionConfigStore(
  'system-bucket',
  'stack-name'
);
```
<a name="module_collection-config-store--CollectionConfigStore+get"></a>

#### collectionConfigStore.get(name, version) ⇒ <code>Promise.&lt;Object&gt;</code>
Fetch a collection config from S3 (or cache if available)

**Kind**: instance method of [<code>CollectionConfigStore</code>](#exp_module_collection-config-store--CollectionConfigStore)
**Returns**: <code>Promise.&lt;Object&gt;</code> - the fetched collection config

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name of the collection config to fetch |
| version | <code>string</code> | the version of the collection config to fetch |

<a name="module_collection-config-store--CollectionConfigStore+put"></a>

#### collectionConfigStore.put(name, version, config) ⇒ <code>Promise.&lt;null&gt;</code>
Store a collection config to S3

**Kind**: instance method of [<code>CollectionConfigStore</code>](#exp_module_collection-config-store--CollectionConfigStore)
**Returns**: <code>Promise.&lt;null&gt;</code> - resolves when the collection config has been written
  to S3

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name of the collection config to store |
| version | <code>string</code> | version of Collection |
| config | <code>Object</code> | the collection config to store |

<a name="module_collection-config-store--CollectionConfigStore+delete"></a>

#### collectionConfigStore.delete(name, version) ⇒ <code>Promise.&lt;null&gt;</code>
Delete a collection config from S3

**Kind**: instance method of [<code>CollectionConfigStore</code>](#exp_module_collection-config-store--CollectionConfigStore)
**Returns**: <code>Promise.&lt;null&gt;</code> - resolves when the collection config has been deleted
  to S3

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name of the collection config to delete |
| version | <code>string</code> | version of Collection |


---

Generated automatically using `npm run build-docs`

# @cumulus/common API Documentation

## Modules

<dl>
<dt><a href="#module_URLUtils">URLUtils</a></dt>
<dd><p>A collection of utilities for working with URLs</p>
</dd>
<dt><a href="#module_util">util</a></dt>
<dd><p>Simple utility functions</p>
</dd>
</dl>

<a name="module_URLUtils"></a>

## URLUtils
A collection of utilities for working with URLs

**Example**
```js
const { buildURL } = require('@cumulus/common/URLUtils');

buildURL({ protocol: 'http', host: 'example.com' }); // => 'http://example.com'
```
<a name="exp_module_URLUtils--buildURL"></a>

### buildURL(params) ⇒ <code>string</code> ⏏
Build a URL

**Kind**: Exported function
**Returns**: <code>string</code> - a URL
**Throws**:

- <code>TypeError</code> if protocol or host are not specified


| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | URL parameters |
| params.protocol | <code>string</code> | the protocol ('http', 'ftp', 's3', etc) |
| params.host | <code>string</code> | the host |
| [params.port] | <code>string</code> \| <code>integer</code> | the port |
| [params.path] | <code>string</code> \| <code>Array.&lt;string&gt;</code> | path segment(s) to add to the end of   the URL.  Can be either a string or an array of strings, which will be   joined together. |

**Example**
```js
buildURL({
  protocol: 'http'
  host: 'example.com',
  port: 8080,
  path: ['path', 'to', 'file.txt']
}); // => 'http://example.com:8080/path/to/file.txt'
```
<a name="module_util"></a>

## util
Simple utility functions


* [util](#module_util)
    * [exports.deprecate](#exp_module_util--exports.deprecate) ⏏
    * [removeNilProperties(obj)](#exp_module_util--removeNilProperties) ⇒ <code>Object</code> ⏏
    * [exports.isOneOf(collection, val)](#exp_module_util--exports.isOneOf) ⇒ <code>boolean</code> ⏏

<a name="exp_module_util--exports.deprecate"></a>

### exports.deprecate ⏏
Mark a piece of code as deprecated.

Each deprecation notice for a given name and version combination will
only be printed once.

**Kind**: Exported member

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name of the function / method / class to deprecate |
| version | <code>string</code> | the version after which the code will be marked   as deprecated |
| [alternative] | <code>string</code> | the function / method / class to use instead   of this deprecated code |

<a name="exp_module_util--removeNilProperties"></a>

### removeNilProperties(obj) ⇒ <code>Object</code> ⏏
Remove properties whose values are `null` or `undefined`

**Kind**: Exported function
**Returns**: <code>Object</code> - a shallow clone of the object with `null` and `undefined`
  properties removed

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | object to update |

<a name="exp_module_util--exports.isOneOf"></a>

### exports.isOneOf(collection, val) ⇒ <code>boolean</code> ⏏
Test if a value is included in a list of items

This is a curried function - https://lodash.com/docs/4.17.11#curry

**Kind**: Exported function

| Param | Type | Description |
| --- | --- | --- |
| collection | <code>Array</code> | the list of items to check against |
| val | <code>Object</code> | the item to check for in the collection |


---

Generated automatically using `npm run build-docs`

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
<a name="exp_module_URLUtils--exports.buildURL"></a>

### exports.buildURL(params) ⇒ <code>string</code> ⏏
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

**Example**  
```js
const { isNil } = require('@cumulus/common/util');

isNil(undefined); // => true
```

* [util](#module_util)
    * [exports.deprecate](#exp_module_util--exports.deprecate) ⏏
    * ~~[exports.sleep(waitPeriodMs)](#exp_module_util--exports.sleep) ⇒ <code>Promise.&lt;undefined&gt;</code> ⏏~~
    * ~~[exports.noop()](#exp_module_util--exports.noop) ⇒ <code>undefined</code> ⏏~~
    * ~~[exports.omit(objectIn, keys)](#exp_module_util--exports.omit) ⇒ <code>Object</code> ⏏~~
    * ~~[exports.negate(predicate)](#exp_module_util--exports.negate) ⇒ <code>function</code> ⏏~~
    * ~~[exports.isNull(x)](#exp_module_util--exports.isNull) ⇒ <code>boolean</code> ⏏~~
    * ~~[exports.isUndefined(x)](#exp_module_util--exports.isUndefined) ⇒ <code>boolean</code> ⏏~~
    * ~~[exports.isNil(x)](#exp_module_util--exports.isNil) ⇒ <code>boolean</code> ⏏~~
    * ~~[exports.renameProperty(from, to, obj)](#exp_module_util--exports.renameProperty) ⇒ <code>Object</code> ⏏~~
    * [exports.removeNilProperties(obj)](#exp_module_util--exports.removeNilProperties) ⇒ <code>Object</code> ⏏
    * ~~[exports.lookupMimeType(key)](#exp_module_util--exports.lookupMimeType) ⇒ <code>string</code> ⏏~~
    * [exports.isOneOf(collection, val)](#exp_module_util--exports.isOneOf) ⇒ <code>boolean</code> ⏏
    * ~~[exports.thread(value, ...fns)](#exp_module_util--exports.thread) ⇒ <code>\*</code> ⏏~~

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

<a name="exp_module_util--exports.sleep"></a>

### ~~exports.sleep(waitPeriodMs) ⇒ <code>Promise.&lt;undefined&gt;</code> ⏏~~
***Deprecated***

Wait for the defined number of milliseconds

**Kind**: Exported function  
**Returns**: <code>Promise.&lt;undefined&gt;</code> - promise resolves after a given time period  

| Param | Type | Description |
| --- | --- | --- |
| waitPeriodMs | <code>number</code> | number of milliseconds to wait |

<a name="exp_module_util--exports.noop"></a>

### ~~exports.noop() ⇒ <code>undefined</code> ⏏~~
***Deprecated***

Does nothing.  Used where a callback is required but not used.

**Kind**: Exported function  
**Returns**: <code>undefined</code> - undefined  
<a name="exp_module_util--exports.omit"></a>

### ~~exports.omit(objectIn, keys) ⇒ <code>Object</code> ⏏~~
***Deprecated***

Replacement for lodash.omit returns a shallow copy of input object
with keys removed.
(lodash.omit will be removed in v5.0.0)
https://github.com/lodash/lodash/wiki/Roadmap#v500-2019

**Kind**: Exported function  
**Returns**: <code>Object</code> - copy of objectIn without keys attached.  

| Param | Type | Description |
| --- | --- | --- |
| objectIn | <code>Object</code> | input object |
| keys | <code>string</code> \| <code>Array.&lt;string&gt;</code> | key or list of keys to remove from object |

<a name="exp_module_util--exports.negate"></a>

### ~~exports.negate(predicate) ⇒ <code>function</code> ⏏~~
***Deprecated***

Creates a function that returns the opposite of the predicate function.

**Kind**: Exported function  
**Returns**: <code>function</code> - the new negated function  

| Param | Type | Description |
| --- | --- | --- |
| predicate | <code>function</code> | the predicate to negate |

**Example**  
```js
const isEven = (x) => x % 2 === 0;
const isOdd = negate(isEven);

isOdd(2); // => false
isOdd(3); // => true
```
<a name="exp_module_util--exports.isNull"></a>

### ~~exports.isNull(x) ⇒ <code>boolean</code> ⏏~~
***Deprecated***

Test if a value is null

**Kind**: Exported function  

| Param | Type | Description |
| --- | --- | --- |
| x | <code>\*</code> | value to check |

<a name="exp_module_util--exports.isUndefined"></a>

### ~~exports.isUndefined(x) ⇒ <code>boolean</code> ⏏~~
***Deprecated***

Test if a value is undefined

**Kind**: Exported function  

| Param | Type | Description |
| --- | --- | --- |
| x | <code>\*</code> | value to check |

<a name="exp_module_util--exports.isNil"></a>

### ~~exports.isNil(x) ⇒ <code>boolean</code> ⏏~~
***Deprecated***

Test if a value is null or undefined

**Kind**: Exported function  

| Param | Type | Description |
| --- | --- | --- |
| x | <code>\*</code> | value to check |

<a name="exp_module_util--exports.renameProperty"></a>

### ~~exports.renameProperty(from, to, obj) ⇒ <code>Object</code> ⏏~~
***Deprecated***

Rename an object property

**Kind**: Exported function  
**Returns**: <code>Object</code> - a shallow clone of the object with updated property name  

| Param | Type | Description |
| --- | --- | --- |
| from | <code>string</code> | old property name |
| to | <code>string</code> | new property name |
| obj | <code>Object</code> | object to update |

<a name="exp_module_util--exports.removeNilProperties"></a>

### exports.removeNilProperties(obj) ⇒ <code>Object</code> ⏏
Remove properties whose values are `null` or `undefined`

**Kind**: Exported function  
**Returns**: <code>Object</code> - a shallow clone of the object with `null` and `undefined`
  properties removed  

| Param | Type | Description |
| --- | --- | --- |
| obj | <code>Object</code> | object to update |

<a name="exp_module_util--exports.lookupMimeType"></a>

### ~~exports.lookupMimeType(key) ⇒ <code>string</code> ⏏~~
***Deprecated***

Return mime-type based on input url or filename

**Kind**: Exported function  
**Returns**: <code>string</code> - mimeType or null  

| Param | Type |
| --- | --- |
| key | <code>string</code> | 

<a name="exp_module_util--exports.isOneOf"></a>

### exports.isOneOf(collection, val) ⇒ <code>boolean</code> ⏏
Test if a value is included in a list of items

This is a curried function - https://lodash.com/docs/4.17.11#curry

**Kind**: Exported function  

| Param | Type | Description |
| --- | --- | --- |
| collection | <code>Array</code> | the list of items to check against |
| val | <code>Object</code> | the item to check for in the collection |

<a name="exp_module_util--exports.thread"></a>

### ~~exports.thread(value, ...fns) ⇒ <code>\*</code> ⏏~~
***Deprecated***

Pass a value through a pipeline of functions and return the result

**Kind**: Exported function  
**Returns**: <code>\*</code> - the result of passing the value through the functions:
  - If no functions are provided, the value is returned.
  - Functions should expect a single argument  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>\*</code> | the value to be passed through the pipeline of functions |
| ...fns | <code>function</code> | the functions to be invoked |


---

Generated automatically using `npm run build-docs`

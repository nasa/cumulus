# @cumulus/checksum

## Checksum

The `@cumulus/checksum` library provides checksum functionality used by Cumulus
packages and tasks. Currently the supported input includes file streams, and
supported checksum algorithms include `cksum` and the algorithms available to
the `crypto` package, as documented
[here](https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm_options).

## Usage

```js
const fs = require('fs');
const { generateChecksumFromStream } = require('@cumulus/checksum');

const stream = fs.createReadStream('myDataFile.hdf');
const myCksum = generateChecksumFromStream('cksum', stream);
```

## API

<a name="module_checksum"></a>

## checksum

* [checksum](#module_checksum)
    * [.generateChecksumFromStream(algorithm, stream, [options])](#module_checksum.generateChecksumFromStream) ⇒ <code>Promise.&lt;(number\|string)&gt;</code>
    * [.validateChecksumFromStream(algorithm, stream, expectedSum, [options])](#module_checksum.validateChecksumFromStream) ⇒ <code>Promise.&lt;boolean&gt;</code>

<a name="module_checksum.generateChecksumFromStream"></a>

### checksum.generateChecksumFromStream(algorithm, stream, [options]) ⇒ <code>Promise.&lt;(number\|string)&gt;</code>
Create <algorithm> file checksum from readable stream

**Kind**: static method of [<code>checksum</code>](#module_checksum)
**Returns**: <code>Promise.&lt;(number\|string)&gt;</code> - the file checksum

| Param | Type | Description |
| --- | --- | --- |
| algorithm | <code>string</code> | Checksum algorithm type |
| stream | <code>stream.Readable</code> | A readable file stream |
| [options] | <code>Object</code> | Checksum options, see `crypto.createHash()` |

<a name="module_checksum.validateChecksumFromStream"></a>

### checksum.validateChecksumFromStream(algorithm, stream, expectedSum, [options]) ⇒ <code>Promise.&lt;boolean&gt;</code>
Validate expected checksum against calculated checksum

**Kind**: static method of [<code>checksum</code>](#module_checksum)
**Returns**: <code>Promise.&lt;boolean&gt;</code> - whether expectedSum === calculatedSum

| Param | Type | Description |
| --- | --- | --- |
| algorithm | <code>string</code> | Checksum algorithm |
| stream | <code>stream.Readable</code> | A readable file stream |
| expectedSum | <code>number</code> \| <code>string</code> | expected checksum |
| [options] | <code>Object</code> | Checksum options |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management
prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

---
Generated automatically using `npm run build-docs`

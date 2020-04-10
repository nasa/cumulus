# @cumulus/integration-tests

Utilities for writing integration tests against Cumulus.

## Install

```shell
$ npm install @cumulus/integration-tests
```

## API

### Collections

```js
const collections = require('@cumulus/integration-test/collections');
```

#### collections.createCollection(prefix, [overrides])

Create a collection using the Cumulus API.

- `prefix` is the name of the Cumulus stack
- `overrides` is an `Object` that contains values that should override the
  default collection values
- Returns a `Promise` that resolves to the created collection

The default collection is very simple. It expects that, for any discovered file,
the granule ID is everything in the filename before the extension. For example,
a file named `gran-1.txt` would have a granuleId of `gran-1`. Filenames can only
contain a single `.` character.

**Collection defaults**

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

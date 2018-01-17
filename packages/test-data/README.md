# @cumulus/test-data

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

@cumulus/test-data provides a collection of example data for use in testing Cumulus modules.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Installation

```
npm install @cumulus/test-data
```

## Using data from this package

Using `require` or `import`:

```js
const payload = require('@cumulus/test-data/payloads/new-message-schema/ingest.json');
import payload from '@cumulus/test-data/payloads/new-message-schema/ingest.json';
```

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)

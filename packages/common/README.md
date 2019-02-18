# @cumulus/common

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

Common libraries used in Cumulus.

## Usage
```
$ npm install @cumulus/common
```

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## General Utilities

* [@cumulus/common/aws](./aws.js) - Utilities for working with AWS. For ease of
  setup, testing, and credential management, code should obtain AWS client
  objects from helpers in this module.
* [@cumulus/common/concurrency](./concurrency.js) - Implementations of
  distributed concurrency primitives (mutex, semaphore) using DynamoDB
* [@cumulus/common/errors](./errors.js) - Classes for thrown errors
* [@cumulus/common/local-helpers](./local-helpers.js) - Provides methods for
  setting up message payloads for use in development / local testing
* [@cumulus/common/log](./log.js) - muting or potentially shipping logs to
  alternative locations
* [@cumulus/common/string](./docs/API.md#module_string) - Utilities for
  manipulating strings
* [@cumulus/common/test-utils](./test-utils.js) - Utilities for writing tests
* [@cumulus/common/URLUtils](./docs/API.md#module_URLUtils) - a collection of
  utilities for working with URLs
* [@cumulus/common/util](./docs/API.md#module_util) - Other misc general
  utilities

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)

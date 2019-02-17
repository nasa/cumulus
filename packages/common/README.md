# @cumulus/common

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

Common libraries used in Cumulus.

## Install
```
$ npm install @cumulus/common
```

## API Documentation
* [@cumulus/common/util](./README-util.md) - a collection of small utility
  functions

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## General Utilities

 * [@cumulus/common/aws](./aws.js)
   Utilities for working with AWS. For ease of setup, testing, and credential management, code
   should obtain AWS client objects from helpers in this module.
 * [@cumulus/common/concurrency](./concurrency.js)
   Implementations of distributed concurrency primitives (mutex, semaphore) using DynamoDB
 * [@cumulus/common/errors](./errors.js)
   Classes for thrown errors
 * [@cumulus/common/log](./log.js)
   Log helpers. Code should use this instead of console.* directly to enable tagging, timestamping,
   muting or potentially shipping logs to alternative locations
 * [@cumulus/common/string](./string.js)
   Utilities for manipulating strings
 * [@cumulus/common/util](./util.js)
   Other misc general utilities
 * [@cumulus/common/test-utils](./test-utils.js)
   Utilities for writing tests
 * [@cumulus/common/local-helpers](./local-helpers.js):
   Provides methods for setting up message payloads for use in development / local testing

## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)

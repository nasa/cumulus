# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- CUMULUS-175: Dashboard providers not in sync with AWS providers. The root cause of this (dynamodb operations not showing up in elasticsearch) issue was shared by collections and rules so the fix involved those resources in addition to providers. To fix this issue the following changes were made:
  - `@cumulus/deployment` deploys DynamoDB streams for the Collections, Providers and Rules tables as well as a new lambda function called `dbIndexer`. The dbIndexer lambda has an event source mapping which listens to each of the DynamoDB streams. The dbIndexer lambda receives events referencing operations on the DynamoDB table and updates the elasticsearch cluster accordingly.
  - The `@cumulus/api` endpoints for collections, providers and rules query dynamodb instead of elasticsearch, with the exception of _all_ list and the collections get endpoints.

## [v1.1.0] - 2018-03-05

### Added

- Added a `jlog` function to `common/test-utils` to aid in test debugging
- Integration test package with command line tool [CUMULUS-200] by @laurenfrederick
- Test for FTP `useList` flag [CUMULUS-334] by @kkelly51

### Updated
- The `queue-pdrs` task now uses the [cumulus-message-adapter-js](https://github.com/cumulus-nasa/cumulus-message-adapter-js)
  library
- Updated the `queue-pdrs` JSON schemas
- The test-utils schema validation functions now throw an error if validation
  fails
- The `queue-granules` task now uses the [cumulus-message-adapter-js](https://github.com/cumulus-nasa/cumulus-message-adapter-js)
  library
- Updated the `queue-granules` JSON schemas

### Removed
- Removed the `getSfnExecutionByName` function from `common/aws`
- Removed the `getGranuleStatus` function from `common/aws`

## [v1.0.1] - 2018-02-27

### Added
- More tests for discover-pdrs, dicover-granules by @yjpa7145
- Schema validation utility for tests by @yjpa7145

### Changed
- Fix an FTP listing bug for servers that do not support STAT [CUMULUS-334] by @kkelly51

## [v1.0.0] - 2018-02-23

[Unreleased]: https://github.com/cumulus-nasa/cumulus/compare/v1.1.0...HEAD
[v1.1.0]: https://github.com/cumulus-nasa/cumulus/compare/v1.0.1...v1.1.0
[v1.0.1]: https://github.com/cumulus-nasa/cumulus/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/cumulus-nasa/cumulus/compare/pre-v1-release...v1.0.0

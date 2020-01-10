# Data model Changelog

All notable changes to the data models for this project must be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **CUMULUS-1498**
  - Remove the Users table. The list of OAuth users who are allowed to use the
    API is now stored in S3.

### Added

- **CUMULUS-1687**
  - All asyncOperations now include the fields `description` and `operationType`. `operationType` can be one of the following. [`Bulk Delete`, `Bulk Granules`, `ES Index`, `Kinesis Replay`]

[unreleased]: https://github.com/nasa/cumulus/compare/v1.16.0...HEAD

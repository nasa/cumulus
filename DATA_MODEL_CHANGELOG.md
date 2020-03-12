# Data model Changelog

All notable changes to the data models for this project must be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **CUMULUS-1736**
  - The `dataType` property of the collections model has been deprecated and
    should no longer be used. The `name` property should be used instead. There
    shouldn't have ever been a situation where those two values were different.

## [v1.17.0] - 2019-12-31

### Removed

- **CUMULUS-1498**
  - Remove the Users table. The list of OAuth users who are allowed to use the
    API is now stored in S3.

### Added

- **CUMULUS-1687**
  - All asyncOperations now include the fields `description` and `operationType`. `operationType` can be one of the following. [`Bulk Delete`, `Bulk Granules`, `ES Index`, `Kinesis Replay`]

[unreleased]: https://github.com/nasa/cumulus/compare/v1.19.0...HEAD
[v1.19.0]: https://github.com/nasa/cumulus/compare/v1.18.0...v1.19.0
[v1.18.0]: https://github.com/nasa/cumulus/compare/v1.17.0...v1.18.0
[v1.17.0]: https://github.com/nasa/cumulus/compare/v1.16.1...v1.17.0
[v1.16.1]: https://github.com/nasa/cumulus/compare/v1.16.0...v1.16.1
[v1.16.0]: https://github.com/nasa/cumulus/compare/v1.15.0...v1.16.0
[v1.15.0]: https://github.com/nasa/cumulus/compare/v1.14.5...v1.15.0
[v1.14.5]: https://github.com/nasa/cumulus/compare/v1.14.4...v1.14.5
[v1.14.4]: https://github.com/nasa/cumulus/compare/v1.14.3...v1.14.4
[v1.14.3]: https://github.com/nasa/cumulus/compare/v1.14.2...v1.14.3
[v1.14.2]: https://github.com/nasa/cumulus/compare/v1.14.1...v1.14.2
[v1.14.1]: https://github.com/nasa/cumulus/compare/v1.14.0...v1.14.1
[v1.14.0]: https://github.com/nasa/cumulus/compare/v1.13.5...v1.14.0
[v1.13.5]: https://github.com/nasa/cumulus/compare/v1.13.4...v1.13.5
[v1.13.4]: https://github.com/nasa/cumulus/compare/v1.13.3...v1.13.4
[v1.13.3]: https://github.com/nasa/cumulus/compare/v1.13.2...v1.13.3
[v1.13.2]: https://github.com/nasa/cumulus/compare/v1.13.1...v1.13.2
[v1.13.1]: https://github.com/nasa/cumulus/compare/v1.13.0...v1.13.1
[v1.13.0]: https://github.com/nasa/cumulus/compare/v1.12.1...v1.13.0
[v1.12.1]: https://github.com/nasa/cumulus/compare/v1.12.0...v1.12.1
[v1.12.0]: https://github.com/nasa/cumulus/compare/v1.11.3...v1.12.0
[v1.11.3]: https://github.com/nasa/cumulus/compare/v1.11.2...v1.11.3
[v1.11.2]: https://github.com/nasa/cumulus/compare/v1.11.1...v1.11.2
[v1.11.1]: https://github.com/nasa/cumulus/compare/v1.11.0...v1.11.1
[v1.11.0]: https://github.com/nasa/cumulus/compare/v1.10.4...v1.11.0
[v1.10.4]: https://github.com/nasa/cumulus/compare/v1.10.3...v1.10.4
[v1.10.3]: https://github.com/nasa/cumulus/compare/v1.10.2...v1.10.3
[v1.10.2]: https://github.com/nasa/cumulus/compare/v1.10.1...v1.10.2
[v1.10.1]: https://github.com/nasa/cumulus/compare/v1.10.0...v1.10.1
[v1.10.0]: https://github.com/nasa/cumulus/compare/v1.9.1...v1.10.0
[v1.9.1]: https://github.com/nasa/cumulus/compare/v1.9.0...v1.9.1
[v1.9.0]: https://github.com/nasa/cumulus/compare/v1.8.1...v1.9.0
[v1.8.1]: https://github.com/nasa/cumulus/compare/v1.8.0...v1.8.1
[v1.8.0]: https://github.com/nasa/cumulus/compare/v1.7.0...v1.8.0
[v1.7.0]: https://github.com/nasa/cumulus/compare/v1.6.0...v1.7.0
[v1.6.0]: https://github.com/nasa/cumulus/compare/v1.5.5...v1.6.0
[v1.5.5]: https://github.com/nasa/cumulus/compare/v1.5.4...v1.5.5
[v1.5.4]: https://github.com/nasa/cumulus/compare/v1.5.3...v1.5.4
[v1.5.3]: https://github.com/nasa/cumulus/compare/v1.5.2...v1.5.3
[v1.5.2]: https://github.com/nasa/cumulus/compare/v1.5.1...v1.5.2
[v1.5.1]: https://github.com/nasa/cumulus/compare/v1.5.0...v1.5.1
[v1.5.0]: https://github.com/nasa/cumulus/compare/v1.4.1...v1.5.0
[v1.4.1]: https://github.com/nasa/cumulus/compare/v1.4.0...v1.4.1
[v1.4.0]: https://github.com/nasa/cumulus/compare/v1.3.0...v1.4.0
[v1.3.0]: https://github.com/nasa/cumulus/compare/v1.2.0...v1.3.0
[v1.2.0]: https://github.com/nasa/cumulus/compare/v1.1.4...v1.2.0
[v1.1.4]: https://github.com/nasa/cumulus/compare/v1.1.3...v1.1.4
[v1.1.3]: https://github.com/nasa/cumulus/compare/v1.1.2...v1.1.3
[v1.1.2]: https://github.com/nasa/cumulus/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/nasa/cumulus/compare/v1.0.1...v1.1.1
[v1.1.0]: https://github.com/nasa/cumulus/compare/v1.0.1...v1.1.0
[v1.0.1]: https://github.com/nasa/cumulus/compare/v1.0.0...v1.0.1
[v1.0.0]: https://github.com/nasa/cumulus/compare/pre-v1-release...v1.0.0

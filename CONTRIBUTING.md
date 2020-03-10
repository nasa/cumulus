# Contributing

Thanks for considering contributing and making our planet easier to explore!

We're excited you would like to contribute to Cumulus! Whether you're finding bugs, adding new features, fixing anything broken, or improving documentation, get started by submitting an issue or pull request!

## Submitting an Issue

If you have any questions or ideas, or notice any problems or bugs, first [search open issues](https://github.com/nasa/cumulus/issues) to see if the issue has already been submitted. We may already be working on the issue. If you think your issue is new, you're welcome to [create a new issue](https://github.com/nasa/cumulus/issues/new).

## Pull Requests

If you want to submit your own contributions, follow these steps described [here](docs/development/forked-pr.md).

## Guidelines

We ask that you follow these guidelines with your contributions:

### Documentation

Anything exported by a module must be documented using [JSDoc](http://usejsdoc.org/).

The following JSDoc rules are enforced by our [eslint](https://eslint.org/)
configuration:

- Use the `@param` tag instead of `@arg`
- Use the `@returns` tag instead of `@return`
- Preferred param types:
  - "boolean" instead of "Boolean"
  - "number" instead of "Number"
  - "string" instead of "String"
  - "Object" instead of "object"
  - "Array" instead of "array"
  - "Date" instead of "date"
  - "RegExp" instead of "regex" or "Regexp"
  - "Promise" instead of "promise"
- `@param` tags should have a type and a name. Example:
  `@param {string} username`
- Functions that explicitly return should have a `@returns` tag that has a type.
  Example: `@returns {string}`
- Parameter names must match those in the function declaration
- Tags must be valid [JSDoc 3 Block Tags](http://usejsdoc.org/#block-tags)

### Tests

All of the automated tests for this project need to pass before your submission will be accepted.

To run the localized unit tests, follow the instructions in [the README](README.md)

To run the lint/audit checks, please [read this](docs/development/quality-and-coverage.md).

If you add new functionality, please consider adding tests for that functionality as well.

### Commits

* Make small commits that show the individual changes you are making
* Write descriptive commit messages that explain your changes

Example of a good commit message;

```
Improve contributing guidelines. Fixes #10

Improve contributing docs and consolidate them in the standard location https://help.github.com/articles/setting-guidelines-for-repository-contributors/
```

### Changelog

Changes should be documented in CHANGELOG.md. Update the changelog with a description of the changes, including the JIRA issue number. The format should follow [this standard](http://keepachangelog.com/en/1.0.0/).

### For more information on Cumulus governance, see the [EOSDIS General Open Source Software Collaboration and Contribution Process](https://docs.google.com/document/d/1PfyONpRX3_lk2VqOF_yXQ-LKlPGFbJwfXOtuQWdc2BI/edit) and [the Cumulus Wiki](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cumulus).

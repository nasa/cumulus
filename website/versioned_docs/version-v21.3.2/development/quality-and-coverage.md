---
id: quality-and-coverage
---
# Code Coverage and Quality

Currently, code written in this repository leverages Python or TypeScript for most logic and work. The current CI tooling and standards are based on these two languages. Specifics related to the tooling, quality, and testing can be found in the language specific best practices documentation. Python best practices and tooling expectations can be found [here](development/python-best-practices.md). Typescript best practices and tooling can be found [here](development/typescript-best-practices.md).

In addition to CI pipeline quality checks, it is highly recommended for developers to install and configure [pre-commit](https://pre-commit.com) in order to find simple quality issues early. Directions on installing and configuring pre-commit locally for use with this repo can be found [here](docs/development/pre-commit-setup.md).

## Code Coverage

Code coverage is checked using [nyc](https://github.com/istanbuljs/nyc). The
Bamboo build tests coverage. A summary can be viewed in the unit test build's output.

The `npm test` command will output code coverage data for the entire Cumulus
repository. To create an html report, run `nyc report --reporter html` and open
the `index.html` file in the coverage folder.

## Code quality checking

To check the configured linting, run `npm run lint`.

## Documentation quality checking

This project uses [markdownlint-cli](https://www.npmjs.com/package/markdownlint-cli)
as a frontend to [markdownlint](https://www.npmjs.com/package/markdownlint) to check
all of our markdown for style and formatting. The configured rules can be found
[here](https://github.com/nasa/cumulus/blob/master/.markdownlint.json).

To run linting on the markdown files, run `npm run lint-md`.

## Audit

To execute an audit, run `npm run audit`.

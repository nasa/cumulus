---
id: typescript-best-practices
---

# Typescript Best Practices

## Package Management

This project uses [npm](https://www.npmjs.com/) for package management.

## Code Quality and Format

This project uses [eslint](https://eslint.org/) to check code style and quality.
The configured eslint rules can be found in the project's
[.eslintrc.js](https://github.com/nasa/cumulus/blob/master/.eslintrc.js)
file.

To check the configured linting, run `npm run lint`.

## Code Auditing

This project uses `audit-ci` to run a security audit on the package dependency
tree. This must pass prior to merge. The configured rules for `audit-ci` can be
found [here](https://github.com/nasa/cumulus/blob/master/audit-ci.json).

To execute an audit, run `npm run audit`.

## Code Testing and Coverage

Code coverage is checked using [nyc](https://github.com/istanbuljs/nyc). The
Bamboo build tests coverage. A summary can be viewed in the unit test build's output.

The `npm test` command will output code coverage data for the entire Cumulus
repository. To create an html report, run `nyc report --reporter html` and open
the `index.html` file in the coverage folder.

To run code coverage on an individual package during development, run
`npm run test`. This will output the coverage in the terminal.

## Code Documentation

It is expected that whenever possible the code functionality should be documented via a README that includes critical usage and development information such as inputs, outputs, internal and external dependencies, use cases, and critical development information. In addition, the README markdown file should utilize the proper template and conform with [markdown quality standards](docs/development/quality-and-coverage.md).

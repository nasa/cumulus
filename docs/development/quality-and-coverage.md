# Code Coverage and Quality

## Code Coverage

Code coverage is checked using [nyc](https://github.com/istanbuljs/nyc). The
Bamboo build tests coverage. A summary can be viewed in the unit test build's output.

The `npm test` command will output code coverage data for the entire Cumulus
repository. To create an html report, run `nyc report --reporter html` and open
the `index.html` file in the coverage folder.

To run code coverage on an individual package during development, run
`npm run test-coverage`. This will output the coverage in the terminal. An html
report can be created using `nyc report --reporter html` as described above.

## Code quality checking

This project uses [eslint](https://eslint.org/) to check code style and quality.
The configured eslint rules can be found in the project's
[.eslintrc.json](https://github.com/nasa/cumulus/blob/master/.eslintrc.json)
file.

To check the configured linting, run `npm run lint`.

## Documentation quality checking

This project uses [markdownlint-cli](https://www.npmjs.com/package/markdownlint-cli)
as a frontend to [markdownlint](https://www.npmjs.com/package/markdownlint) to check
all of our markdown for style and formatting.   The configured rules can be found
[here](https://github.com/nasa/cumulus/blob/master/.markdownlint.json).

To run linting on the markdown files, run `npm run lint-md`.

## Audit

This project uses `audit-ci` to run a security audit on the package dependency
tree.   This must pass prior to merge.   The configured rules for `audit-ci` can be
found [here](https://github.com/nasa/cumulus/blob/master/audit-ci.json).

To execute an audit, run `npm run audit`.

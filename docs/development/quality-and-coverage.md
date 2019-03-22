# Code Coverage and Quality

## Code Coverage

Code coverage is checked using [nyc](https://github.com/istanbuljs/nyc). The
Travis CI build tests coverage. A summary can be viewed in the build's output.
Detailed code coverage in html can be found by going to the Artifacts tab and
navigating to `index.html` in the coverage folder. Clicking on `index.html` will
take you to an html page showing code coverage for each individual file.

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

In an effort to gradually reduce the number of eslint errors in our codebase,
we are using a script called `eslint-ratchet`. It runs `eslint` against the
repo and compares the number of errors to the previous number of errors. The
previous number of errors is stored in the `.eslint-ratchet-high-water-mark`
file, and tracked in git. If the script is run and the number of errors has
been reduced, the new, lower score is stored in
`.eslint-ratchet-high-water-mark` and should be committed into git. If the
number of errors has increased, the script will fail and tell you that the
number of errors has increased.

To run the script, simply run `./bin/eslint-ratchet` from the top of the
cumulus repository.

The `eslint-ratchet` script is also part of our Travis CI build. If the number
of eslint errors that Travis CI finds has increased, it will fail the build. If
the number of errors has *decreased* from what is stored in
`.eslint-ratchet-high-water-mark`, it will also fail the build. In that case,
run `./bin/eslint-ratchet` and commit the new-and-improved
`.eslint-ratchet-high-water-mark` file.

To help prevent unexpected build failures in Travis CI, I suggest adding a
local post-commit hook that will run eslint-ratchet after every commit. This
will not cause your commits to fail if the score has increased, but it will
let you know that there is a problem. To set up the post-commit hook, create a
file called `.git/hooks/post-commit` which contains:

```
#!/bin/sh

set -e

echo "Running ./bin/eslint-ratchet"
./bin/eslint-ratchet
```

Make sure the hook is executable with `chmod +x .git/hooks/post-commit`

This idea of ratcheting down the number of errors came from Vince Broz's
excellent [quality](https://github.com/apiology/quality) gem.

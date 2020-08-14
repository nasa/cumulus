# @cumulus/db

NOTE: Because this package is not published, it should only be included in code
that will be run through something like webpack.

In order for the audit step to pass in CI, relative links should be used when
this package listed as a dependency. For example:

```json
{
  "dependencies": {
    "@cumulus/db": "../db"
  }
}
```

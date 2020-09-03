# @cumulus/db-migration-lambda

## Creating a new migration

```sh
  npx knex migrate:make migration_name
```

## Note about Webpack compilation

As of version 0.21.5, Knex dynamically loads migration/seed files at runtime:

https://github.com/knex/knex/blob/master/lib/util/import-file.js#L10

By default Webpack converts any `require` statements in compiled code to `_webpack_require` statements so that the referenced files can be loaded from the Webpack bundle. For Knex migration/seed files however, this is not what we want as these files are not included in our Webpack bundle. The only real solution here seems to be using a custom plugin/regex to overwrite `_webpack_require` back to `require` in the file above that loads migration/seed files:

https://github.com/knex/knex/issues/1128#issuecomment-379541266

This workaround has been implemented `webpack.config.js` and **must not be removed**.

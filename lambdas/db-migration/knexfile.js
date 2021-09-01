const { migrationDir } = require('@cumulus/db')
module.exports = {
  client: 'pg',
  migrations: {
    directory: migrationDir,
    stub: 'src/migration-template.ts',
    extension: 'ts',
  },
};

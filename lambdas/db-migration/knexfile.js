module.exports = {
  client: 'pg',
  migrations: {
    directory: 'src/migrations',
    stub: 'src/migration-template.ts',
    extension: 'ts'
  }
};

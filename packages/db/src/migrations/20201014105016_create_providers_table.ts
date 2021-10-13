import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  await knex.schema.createTable('providers', (table) => {
    table
      .increments('cumulus_id')
      .primary();
    table
      .text('name')
      .comment('Provider name')
      .notNullable();
    table
      .enum('protocol', ['http', 'https', 'ftp', 'sftp', 's3'])
      .comment('Protocol for the provider')
      .defaultTo('http')
      .notNullable();
    table
      .text('host')
      .comment('Host name for the provider')
      .notNullable();
    table
      .integer('port')
      .comment('Port name for accessing the provider');
    table
      .text('username')
      .comment('Username for accessing the provider');
    table
      .text('password')
      .comment('Password for accessing the provider');
    table
      .integer('global_connection_limit')
      .comment('Maximum number of allowed concurrent connections to this provider');
    table
      .text('private_key')
      .comment(`
        Private key for accessing the provider, if necessary.
        Should specify a filename that is assumed to exist at
        s3://<your-internal-bucket>/<stack-name>/crypto
      `);
    table
      .text('cm_key_id')
      .comment('AWS KMS Customer Master Key ARN or alias for decrypting credentials');
    table
      .text('certificate_uri')
      .comment('S3 URI (e.g. s3://bucket/key) for custom or self-signed SSL (TLS) certificate to access provider');
    table
      .timestamps(false, true);
    table.unique(['name']);
  });

export const down = async (knex: Knex): Promise<void> => await knex.schema
  .dropTableIfExists('providers');

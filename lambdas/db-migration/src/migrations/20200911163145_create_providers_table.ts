import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  knex.schema.createTable('providers', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .text('name')
      .comment('Provider name')
      .notNullable();
    table
      .enum('protocol', ['http', 'https', 'ftp', 'sftp', 's3'])
      .comment('Protocol for the provider')
      .notNullable();
    table
      .text('host')
      .comment('Host name for the provider')
      .notNullable();
    table
      .integer('port')
      .comment('Port name for acessing the provider');
    table
      .text('username')
      .comment('Username for acessing the provider');
    table
      .text('password')
      .comment('password for acessing the provider');
    table
      .boolean('encrypted')
      .comment('Whether the username/password are stored as encrypted values');
    table
      .integer('globalConnectionLimit')
      .comment('Maximum number of allowed concurrent connections to this provider');
    table
      .text('privateKey')
      .comment(`
        Private key for accessing the provider, if necessary.
        Should specify a filename that is assumed to exist at
        s3://<your-internal-bucket>/<stack-name>/crypto
      `);
    table
      .text('cmKeyId')
      .comment('AWS KMS Customer Master Key ARN or alias for decrypting credentials');
    table
      .text('certificateUri')
      .comment('S3 URI (e.g. s3://bucket/key) for custom or self-signed SSL (TLS) certificate to access provider');
    table
      .timestamps(false, true);
    table.unique(['name']);
  });
};

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('providers');

import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('providers', (table) => {
    table.increments('cumulus_id').primary();

    table.text('name').notNullable();

    table.text('protocol').notNullable().defaultTo('http');

    table.text('host').notNullable();
    table.integer('port');

    table.text('username');
    table.text('password');

    table.integer('global_connection_limit');

    table.text('private_key');
    table.text('cm_key_id');
    table.text('certificate_uri');

    table.timestamps(false, true);

    table.specificType('allowed_redirects', 'text[]');

    table.integer('max_download_time');

    table.unique(['name']);

    table.index(['updated_at'], 'providers_updated_at_index');
  });

  await knex.raw(`
    ALTER TABLE providers
    ADD CONSTRAINT providers_protocol_check
    CHECK (protocol = ANY (ARRAY[
      'http',
      'https',
      'ftp',
      'sftp',
      's3'
    ]));
  `);

  await knex.raw(`
    COMMENT ON COLUMN providers.name IS 'Provider name';
    COMMENT ON COLUMN providers.protocol IS 'Protocol for the provider';
    COMMENT ON COLUMN providers.host IS 'Host name for the provider';
    COMMENT ON COLUMN providers.port IS 'Port name for accessing the provider';
    COMMENT ON COLUMN providers.username IS 'Username for accessing the provider';
    COMMENT ON COLUMN providers.password IS 'Password for accessing the provider';
    COMMENT ON COLUMN providers.global_connection_limit IS 'Maximum number of allowed concurrent connections to this provider';
    COMMENT ON COLUMN providers.private_key IS '
      Private key for accessing the provider, if necessary.
      Should specify a filename that is assumed to exist at
      s3://<your-internal-bucket>/<stack-name>/crypto
    ';
    COMMENT ON COLUMN providers.cm_key_id IS 'AWS KMS Customer Master Key ARN or alias for decrypting credentials';
    COMMENT ON COLUMN providers.certificate_uri IS 'S3 URI (e.g. s3://bucket/key) for custom or self-signed SSL (TLS) certificate to access provider';
    COMMENT ON COLUMN providers.allowed_redirects IS 'Only hosts in this list will have the provider username/password forwarded for authentication. Entries should be specified as host.com or host.com:7000 if redirect port is different than the provider port.';
    COMMENT ON COLUMN providers.max_download_time IS 'Maximum download time in seconds for all granule files on a sync granule task';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('providers');
};

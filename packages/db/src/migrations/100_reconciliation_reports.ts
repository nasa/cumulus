import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('reconciliation_reports', (table) => {
    table.increments('cumulus_id').primary();

    table.text('name').notNullable();
    table.text('type').notNullable();
    table.text('status').notNullable();

    table.text('location');
    table.jsonb('error');

    table.timestamps(false, true);

    table.unique(['name']);

    table.index(['status'], 'reconciliation_reports_status_index');
    table.index(['updated_at'], 'reconciliation_reports_updated_at_index');
  });

  await knex.raw(`
    ALTER TABLE reconciliation_reports
    ADD CONSTRAINT reconciliation_reports_status_check
    CHECK (status = ANY (ARRAY[
      'Generated',
      'Pending',
      'Failed'
    ]));
  `);

  await knex.raw(`
    ALTER TABLE reconciliation_reports
    ADD CONSTRAINT reconciliation_reports_type_check
    CHECK (type = ANY (ARRAY[
      'Granule Inventory',
      'Granule Not Found',
      'Internal',
      'Inventory',
      'ORCA Backup'
    ]));
  `);

  await knex.raw(`
    COMMENT ON COLUMN reconciliation_reports.name IS 'Reconciliation Report name';
    COMMENT ON COLUMN reconciliation_reports.type IS 'Type of Reconciliation Report';
    COMMENT ON COLUMN reconciliation_reports.status IS 'Status of Reconciliation Report';
    COMMENT ON COLUMN reconciliation_reports.location IS 'Location of Reconciliation Report';
    COMMENT ON COLUMN reconciliation_reports.error IS 'Error object';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('reconciliation_reports');
};

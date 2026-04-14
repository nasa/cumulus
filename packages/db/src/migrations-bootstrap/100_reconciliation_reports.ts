import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('reconciliation_reports', (table) => {
    // Primary key
    table.increments('cumulus_id').primary();

    // Columns
    table.text('name').notNullable();
    table.text('type').notNullable();
    table.text('status').notNullable();

    table.text('location');
    table.jsonb('error');

    table.timestamps(false, true);

    // Indexes
    table.index(['status'], 'reconciliation_reports_status_index');
    table.index(['updated_at'], 'reconciliation_reports_updated_at_index');
  });

  // Unique constraint
  await knex.raw(`
    ALTER TABLE reconciliation_reports
    ADD CONSTRAINT reconciliation_reports_name_unique UNIQUE (name);
  `);

  // CHECK constraints
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

  // Comments
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

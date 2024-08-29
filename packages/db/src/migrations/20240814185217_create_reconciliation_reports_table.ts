import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('reconciliation_reports', (table) => {
    table
      .increments('cumulus_id')
      .primary();
    table
      .text('name')
      .comment('Reconciliation Report name');
    table
      .enum('type',
        ['Granule Inventory', 'Granule Not Found', 'Internal', 'Inventory', 'ORCA Backup'])
      .comment('Type of Reconciliation Report');
    table
      .enum('status', ['Generated', 'Pending', 'Failed'])
      .comment('Status of Reconciliation Report');
    table
      .text('location')
      .comment('Location of Reconciliation Report');
    table
      .jsonb('error')
      .comment('Error object');
    // adds "created_at" and "updated_at" columns automatically
    table
      .timestamps(false, true);
    table.index('status');
    table.index('updated_at');
    table.unique(['name']);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('reconciliation_reports');
};

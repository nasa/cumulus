import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('DELETE FROM reconciliation_reports WHERE type = \'ORCA Backup\';');
  await knex.raw(`
        ALTER TABLE reconciliation_reports
        DROP CONSTRAINT IF EXISTS reconciliation_reports_type_check,
        ADD CONSTRAINT reconciliation_reports_type_check
        CHECK (type = ANY (ARRAY[
            'Granule Inventory',
            'Granule Not Found',
            'Internal',
            'Inventory'
        ]));
    `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    ALTER TABLE reconciliation_reports
    DROP CONSTRAINT IF EXISTS reconciliation_reports_type_check,
    ADD CONSTRAINT reconciliation_reports_type_check
    CHECK (type = ANY (ARRAY[
      'Granule Inventory',
      'Granule Not Found',
      'Internal',
      'Inventory',
      'ORCA Backup'
    ]));
  `);
};

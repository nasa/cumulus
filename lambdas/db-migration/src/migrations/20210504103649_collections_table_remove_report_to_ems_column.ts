import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  knex.schema.table('collections', (table) => {
    table
      .dropColumn('report_to_ems')
      .comment('Remove report_to_ems column because reporting is now through Cloud Metrics');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  knex.schema.table('collections', (table) => {
    table
      .boolean('report_to_ems')
      .comment('Flag to set if this collection should be reported to EMS');
  });
};

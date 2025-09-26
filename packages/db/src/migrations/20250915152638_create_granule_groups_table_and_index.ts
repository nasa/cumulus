import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granule_groups', (table) => {
    table
      .integer('granule_cumulus_id')
      .references('cumulus_id')
      .inTable('granules')
      .onDelete('CASCADE')
      .primary();
    table
      .integer('group_id')
      .comment('Granule duplicate group id')
      .notNullable();
    table
      .specificType('state', 'char(1)')
      .comment('Granule active state')
      .notNullable();
    table
      .timestamps(false, true);
  });

  await knex.raw('CREATE SEQUENCE IF NOT EXISTS granule_group_id_seq');

  await knex.raw(`
    ALTER TABLE granule_groups
    ALTER COLUMN group_id SET DEFAULT nextval('granule_group_id_seq');
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS granule_groups_group_id_index ON granule_groups(group_id)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granule_groups');
};

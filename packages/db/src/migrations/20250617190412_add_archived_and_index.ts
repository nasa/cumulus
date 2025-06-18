import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  if (!(await knex.schema.hasColumn('granules', 'archived'))) {
    await knex.schema.table('granules', (table) => {
      table.boolean('archived')
        .comment('granule has been "archived"')
        .defaultTo('false');
    });
  }
  
  if (!(await knex.schema.hasColumn('executions', 'archived'))) {
    await knex.schema.table('executions', (table) => {
      table.boolean('archived')
        .comment('execution has been "archived"')
        .defaultTo('false');
    });
  }
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS executions_archived_index ON executions (archived)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS granules_archived_index ON granules (archived)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS granules_archived_index');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS executions_archived_index');
  
  if (await knex.schema.hasColumn('granules', 'archived')) {
    await knex.schema.table('granules', (table) => {
      table.dropColumn('archived');
    });
  }

  if (await knex.schema.hasColumn('executions', 'archived')) {
    await knex.schema.table('executions', (table) => {
      table.dropColumn('archived');
    });
  }
};
exports.config = {
  transaction: false,
};

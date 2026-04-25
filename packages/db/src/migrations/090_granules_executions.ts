import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules_executions', (table) => {
    table.bigInteger('granule_cumulus_id').notNullable();
    table.bigInteger('collection_cumulus_id').notNullable();
    table.bigInteger('execution_cumulus_id').notNullable();
    table.timestamp('execution_created_at', { useTz: true, precision: 3 }).notNullable();

    table.foreign(['granule_cumulus_id', 'collection_cumulus_id'])
      .references(['cumulus_id', 'collection_cumulus_id'])
      .inTable('granules')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table.foreign(['execution_cumulus_id', 'execution_created_at'])
      .references(['cumulus_id', 'created_at'])
      .inTable('executions')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');

    table.primary(['granule_cumulus_id', 'execution_cumulus_id']);
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_executions');
};

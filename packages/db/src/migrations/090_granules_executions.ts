import { Knex } from 'knex';
import { TIMESTAMP_PRECISION } from '../lib/migration';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules_executions', (table) => {
    table.bigInteger('granule_cumulus_id').notNullable();
    table.bigInteger('collection_cumulus_id').notNullable();
    table.bigInteger('execution_cumulus_id').notNullable();
    table.timestamp('execution_created_at', { useTz: true, precision: TIMESTAMP_PRECISION }).notNullable();

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

    table.index(
      ['execution_cumulus_id', 'execution_created_at'],
      'granules_executions_executions_fkey_idx'
    );
  });

  await knex.raw(`
    COMMENT ON TABLE granules_executions IS 'Join table mapping granules to executions for processing tracking';

    COMMENT ON COLUMN granules_executions.granule_cumulus_id IS 'Identifier of the granule';
    COMMENT ON COLUMN granules_executions.collection_cumulus_id IS 'Identifier of the collection the granule belongs to';
    COMMENT ON COLUMN granules_executions.execution_cumulus_id IS 'Identifier of the execution';
    COMMENT ON COLUMN granules_executions.execution_created_at IS 'Creation timestamp of the execution';
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_executions');
};

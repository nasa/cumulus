import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('granules_executions', (table) => {
    // Foreign keys (join table)
    table.bigInteger('granule_cumulus_id').notNullable();
    table.bigInteger('execution_cumulus_id').notNullable();

    // Index for performance (implicit but good practice)
    table.index(
      ['granule_cumulus_id', 'execution_cumulus_id'],
      'granules_executions_granule_execution_index'
    );
  });

  // Unique constraint (composite)
  await knex.raw(`
    ALTER TABLE granules_executions
    ADD CONSTRAINT granules_executions_granule_cumulus_id_execution_cumulus_id_uni
    UNIQUE (granule_cumulus_id, execution_cumulus_id);
  `);

  // Foreign key → executions
  await knex.raw(`
    ALTER TABLE granules_executions
    ADD CONSTRAINT granules_executions_execution_cumulus_id_foreign
    FOREIGN KEY (execution_cumulus_id)
    REFERENCES executions(cumulus_id)
    ON DELETE CASCADE;
  `);

  // Foreign key → granules
  await knex.raw(`
    ALTER TABLE granules_executions
    ADD CONSTRAINT granules_executions_granule_cumulus_id_foreign
    FOREIGN KEY (granule_cumulus_id)
    REFERENCES granules(cumulus_id)
    ON DELETE CASCADE;
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('granules_executions');
};

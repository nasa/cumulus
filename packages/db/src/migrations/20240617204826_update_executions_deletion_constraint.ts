import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_parent_cumulus_id_foreign');
  await knex.raw('ALTER TABLE executions ADD CONSTRAINT executions_parent_cumulus_id_foreign FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id) ON DELETE SET NULL');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_parent_cumulus_id_foreign');
  await knex.raw('ALTER TABLE executions ADD CONSTRAINT executions_parent_cumulus_id_foreign FOREIGN KEY (parent_cumulus_id) REFERENCES executions(cumulus_id)');
};

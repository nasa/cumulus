import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('ALTER SEQUENCE executions_cumulus_id_seq AS BIGINT');
};

export const down = async (): Promise<void> => {
  console.log('Warning - this migration cannot be rolled back');
};

exports.config = {
  transaction: false,
};

import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('collections', (table) => {
    table.text('metrics_provider').notNullable();
    table.index(['metrics_provider'], 'collection_metrics_provider_index');
  });
  await knex.raw(`  
    COMMENT ON COLUMN collections.metrics_provider IS 'Value is used to differentiate metrics stack on a per-collection basis.';  
  `);

};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'metrics_provider')) {
    await knex.schema.alterTable('collections', (table) => {
      table.dropColumn('metrics_provider');
    });
  }
};

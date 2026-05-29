import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.alterTable('collections', (table) => {
    table.text('metrics_provider').notNullable();
    table.index(['metrics_provider'], 'collection_metrics_provider_index');
  });
  await knex.raw(`  
    COMMENT ON COLUMN collections.metrics_provider IS 'metrics provider for this collection, disambiguating for metrics routing purposes';
  `);

};

export const down = async (knex: Knex): Promise<void> => {
  if (await knex.schema.hasColumn('collections', 'metrics_provider')) {
    await knex.schema.alterTable('collections', (table) => {
      table.dropColumn('metrics_provider');
    });
  }
};

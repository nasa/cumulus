import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('collections', (table) => {
    table.increments('cumulusId').primary();
    table.string('name').notNullable();
    table.string('version').notNullable();
    table.string('sampleFileName').notNullable();
    table.string('granuleIdValidationRegex').notNullable(); // does this need to be longer than 255 chars?
    table.string('granuleIdExtraction').notNullable(); // does this need to be longer than 255 chars?
    table.jsonb('files').notNullable();
    table.string('process');
    table.string('url_path');
    table.enum('duplicateHandling', ['error', 'replace', 'skip', 'version']);
    table.boolean('reportToEms');
    table.boolean('ignoreFilesConfigForDiscovery');
    table.jsonb('meta');
    table.jsonb('tags');
    // adds "created_at" and "updated_at" columns automatically
    table.timestamps(false, true);

    // add unique constraints
    table.unique(['name', 'version']);
  });

export const down = async (knex: Knex): Promise<void> =>
  knex.schema.dropTable('collections');

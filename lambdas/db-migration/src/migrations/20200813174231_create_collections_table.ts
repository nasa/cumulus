import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  knex.schema.createTable('collections', (table) => {
    table.integer('cumulusId').primary();
    table.string('name');
    table.string('version');
    table.string('process');
    table.string('url_path');
    table.enum('duplicateHandling', ['error', 'replace', 'skip', 'version']);
    table.string('granuleIdValidationRegex'); // does this need to be longer than 255 chars?
    table.string('granuleIdExtraction'); // does this need to be longer than 255 chars?
    table.boolean('reportToEms');
    table.string('sampleFileName');
    table.boolean('ignoreFilesConfigForDiscovery');
    table.jsonb('files');
    table.jsonb('meta');
    table.timestamps(); // adds "created_at" and "updated_at" columns automatically
  });
};

export const down = async (knex: Knex): Promise<void> => {
  knex.schema.dropTable('collections');
};

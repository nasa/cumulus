import * as fs from 'fs';
import * as path from 'path';
import { Knex } from 'knex';

/**
 * Seeds the migration history table so that existing patch migrations
 * are ignored after a bootstrap initialization.
 *
 * @param knex - DB client
 */
export const up = async (knex: Knex): Promise<void> => {
  const migrationsDir = path.resolve(__dirname, '../migrations');

  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .sort();

  const alreadyRun = await knex('knex_migrations').pluck('name');

  const newEntries = migrationFiles
    .filter((name) => !alreadyRun.includes(name))
    .map((name) => ({
      name,
      batch: 1,
      migration_time: new Date(),
    }));

  if (newEntries.length > 0) {
    await knex('knex_migrations').insert(newEntries);
  }
};

exports.down = async () => {};

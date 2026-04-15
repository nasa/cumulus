import { Knex } from 'knex';

const addConstraintIfNotExists = async ({
  knex,
  tableName,
  constraintName,
  constraintSql,
}: {
  knex: Knex,
  tableName: string,
  constraintName: string,
  constraintSql: string,
}): Promise<void> => {
  const constraintExists = await knex.raw(`
    SELECT constraint_name
    FROM information_schema.constraint_column_usage
    WHERE constraint_name = ?
    AND table_name = ?
  `, [constraintName, tableName]);

  if (constraintExists.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE ${tableName} ${constraintSql}
    `);
    console.log(`Constraint ${constraintName} added to table ${tableName}`);
  } else {
    console.log(`Constraint ${constraintName} already exists on table ${tableName}`);
  }
};

export const up = async (knex: Knex): Promise<void> => {
  // ALTER TABLE granules ADD UNIQUE USING INDEX granules_collection_cumulus_id_granule_id_unique
  await addConstraintIfNotExists({
    knex,
    tableName: 'granules',
    constraintName: 'granules_collection_cumulus_id_granule_id_unique',
    constraintSql: 'ADD UNIQUE USING INDEX granules_collection_cumulus_id_granule_id_unique',
  });

  await knex.raw('ALTER TABLE granules DROP constraint IF EXISTS granules_granule_id_collection_cumulus_id_unique');
};

export const down = async (knex: Knex): Promise<void> => {
  // ALTER TABLE granules ADD CONSTRAINT
  // granules_granule_id_collection_cumulus_id_unique UNIQUE (granule_id, collection_cumulus_id)
  await addConstraintIfNotExists({
    knex,
    tableName: 'granules',
    constraintName: 'granules_granule_id_collection_cumulus_id_unique',
    constraintSql: 'ADD CONSTRAINT granules_granule_id_collection_cumulus_id_unique UNIQUE (granule_id, collection_cumulus_id)',
  });

  await knex.raw('ALTER TABLE granules DROP CONSTRAINT IF EXISTS granules_collection_cumulus_id_granule_id_unique');
};

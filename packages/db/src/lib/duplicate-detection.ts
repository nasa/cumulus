import { Knex } from 'knex';
import { deconstructCollectionId } from '@cumulus/message/Collections';
import { CollectionPgModel } from '../models/collection';

export type GranuleInput = {
  collectionId: string;
  producerGranuleId: string;
  collectionCumulusId?: number;
  granuleId?: string;
};

export type GranuleGroupRecord = {
  cumulus_id: number;
  granule_id: string;
  producer_granule_id: string;
  collection_cumulus_id: number;
  status: string;
  group_state: string | null;
};

export type DuplicateGranulesResult = {
  /**
   * Granules that have the same producerGranuleId and belong to the same collection
   * as the input granule.
   */
  sameCollectionMatches: GranuleGroupRecord[];
  /**
   * Granules that have the same producerGranuleId but belong to a different collection
   * than the input granule.
   */
  differentCollectionMatches: GranuleGroupRecord[];
  /**
   * Granules that match the input granule based on custom-defined duplication criteria.
   * Currently unused and always returns an empty array; reserved for future enhancements.
   */
  customCriteriaMatches: GranuleGroupRecord[];
};

export const getNextGranuleGroupId = async (knex: Knex) : Promise<number> => {
  const result = await knex.raw("SELECT nextval('granule_group_id_seq')::int");
  return result.rows[0].nextval;
};

/**
 * Finds "active" duplicate granules based on the `producerGranuleId` and associated collection,
 * and excludes input granule itself by `granuleId` if provided
 *
 * A granule is considered a duplicate if it shares the same `producerGranuleId` as the
 * input granule.
 * It is considered "active" if:
 *   - It is either not in the `granule_groups` table, OR
 *   - Its associated `granule_groups.state` is NOT equal to `'H'` (i.e., not hidden).
 *
 * @param input - The granule input object
 * @param knex - DB client
 * @param collectionPgModel - (Optional) Instance of the collection database model
 * @returns - the duplicate granules found
 */
export const findActiveDuplicateGranules = async (
  input: GranuleInput,
  knex: Knex,
  collectionPgModel = new CollectionPgModel()
): Promise<DuplicateGranulesResult> => {
  const {
    collectionId,
    producerGranuleId,
    granuleId,
  } = input;

  let { collectionCumulusId } = input;

  // Ensure we have collectionCumulusId
  if (!collectionCumulusId) {
    const pgCollection = await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
    );
    collectionCumulusId = pgCollection.cumulus_id;
  }

  // Query for active granules with matching producerGranuleId
  const duplicates = await knex('granules')
    .leftJoin('granule_groups', 'granules.cumulus_id', 'granule_groups.granule_cumulus_id')
    .where('granules.producer_granule_id', producerGranuleId)
    .modify((qb) => {
      if (granuleId) {
        qb.whereNot('granules.granule_id', granuleId);
      }
    })
    .andWhere((qb) =>
      qb.where('granule_groups.state', '!=', 'H').orWhereNull('granule_groups.state'))
    .select(
      'granules.cumulus_id',
      'granules.granule_id',
      'granules.producer_granule_id',
      'granules.collection_cumulus_id',
      'granules.status',
      'granule_groups.state as group_state'
    ) as GranuleGroupRecord[];

  // Split results by collection
  const sameCollectionMatches = duplicates.filter(
    (g) => g.collection_cumulus_id === collectionCumulusId
  );
  const differentCollectionMatches = duplicates.filter(
    (g) => g.collection_cumulus_id !== collectionCumulusId
  );

  return {
    sameCollectionMatches,
    differentCollectionMatches,
    customCriteriaMatches: [],
  };
};

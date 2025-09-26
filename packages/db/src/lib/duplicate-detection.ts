import { Knex } from 'knex';
import { deconstructCollectionId } from '@cumulus/message/Collections';
import { CollectionPgModel } from '../models/collection';

type GranuleInput = {
  collectionId: string;
  producerGranuleId: string;
  collectionCumulusId?: number;
  granuleId?: string;
};

type GranuleRecord = {
  cumulus_id: number;
  granule_id: string;
  producer_granule_id: string;
  collection_cumulus_id: number;
  status: string;
  group_state: string | null;
};

type DuplicateGranulesResult = {
  sameCollectionMatches: GranuleRecord[];
  differentCollectionMatches: GranuleRecord[];
  customCriteriaMatches: GranuleRecord[];
};

export const getNextGranuleGroupId = async (knex: Knex) : Promise<number> => {
  const result = await knex.raw("SELECT nextval('granule_group_id_seq')");
  return Number(result.rows[0].nextval);
};

/**
 * Detects "active" duplicate granules based on producerGranuleId and collection.
 * A granule is considered "active" if its `granule_groups.state != 'H'` or it's
 * not in granule_groups.
 */
export const findDuplicateGranules = async (
  incoming: GranuleInput,
  knex: Knex,
  collectionPgModel = new CollectionPgModel(),
): Promise<DuplicateGranulesResult> => {
  const {
    collectionId,
    producerGranuleId,
    granuleId,
  } = incoming;

  let { collectionCumulusId } = incoming;

  // Ensure we have collectionCumulusId
  if (!collectionCumulusId) {
    const { cumulus_id } = await collectionPgModel.get(
      knex,
      deconstructCollectionId(collectionId)
    );
    collectionCumulusId = cumulus_id;
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
      qb.where('granule_groups.state', '!=', 'H').orWhereNull('granule_groups.state')
    )
    .select(
      'granules.cumulus_id',
      'granules.granule_id',
      'granules.producer_granule_id',
      'granules.collection_cumulus_id',
      'granules.status',
      'granule_groups.state as group_state'
    ) as GranuleRecord[];

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
    customCriteriaMatches: [], // Placeholder
  };
};

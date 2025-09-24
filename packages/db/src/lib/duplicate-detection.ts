import { Knex } from 'knex';

type GranuleInput = {
  collectionCumulusId: number;
  producerGranuleId: string;
  granuleId?: string;
};

type GranuleRecord = {
  cumulus_id: number;
  granule_id: string;
  producer_granule_id: string;
  collection_cumulus_id: number;
  status: string;
  group_state: string | null; // 'H', or null if no entry
};

type DuplicateGranulesResult = {
  sameCollectionMatches: GranuleRecord[];
  differentCollectionMatches: GranuleRecord[];
  customCriteriaMatches: GranuleRecord[]; // Placeholder
};

/**
 * Detects "active" duplicate granules based on producerGranuleId and collection.
 * A granule is considered "active" if its `granule_groups.state != 'H'` or it's
 * not in granule_groups.
 */
export async function findDuplicateGranules(
  knex: Knex,
  incomingGranule: GranuleInput
): Promise<DuplicateGranulesResult> {
  const {
    producerGranuleId,
    granuleId,
    collectionCumulusId,
  } = incomingGranule;

  const baseQuery = knex('granules')
    .leftJoin('granule_groups', 'granules.cumulus_id', 'granule_groups.granule_cumulus_id')
    .where((builder) =>
      builder.where('granule_groups.state', '!=', 'H').orWhereNull('granule_groups.state'))
    .select(
      'granules.cumulus_id',
      'granules.granule_id',
      'granules.producer_granule_id',
      'granules.collection_cumulus_id',
      'granules.status',
      'granule_groups.state as group_state'
    );

  const sameProducerGranuleIdResults = await baseQuery.clone()
    .where({ 'granules.producer_granule_id': producerGranuleId })
    .modify((queryBuilder) => {
    if (granuleId != null) {
      queryBuilder.whereNot('granules.granule_id', granuleId);
    }
  });

  // 1. Same producerGranuleId in the same collection
  const sameCollectionMatches = sameProducerGranuleIdResults.filter((record: GranuleRecord) =>
    record.collection_cumulus_id === collectionCumulusId);

  // 2. Same producerGranuleId in a different collection
  const differentCollectionMatches = sameProducerGranuleIdResults.filter((record: GranuleRecord) =>
    record.collection_cumulus_id !== collectionCumulusId);

  // 3. Placeholder for future criteria within a collection
  const customCriteriaMatches: GranuleRecord[] = [];

  return {
    sameCollectionMatches,
    differentCollectionMatches,
    customCriteriaMatches,
  };
}

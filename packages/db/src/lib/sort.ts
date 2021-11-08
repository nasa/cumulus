/**
 * Returns an array of sort fields and their order for use with PostGres
 * modified from @cumulus/es-client/queries
 *
 * @param {Object} params - sort params
 */

export const getSortFields = (
  params: { sort_by?: string, order?: string, sort_key?: Array<string> }
) => {
  let sort;
  const { sort_by: sortBy, order, sort_key: sortKey } = params;

  if (sortBy && order) {
    const sortField = sortBy;
    sort = [{ [sortField]: { order: order } }];
  } else if (sortKey && Array.isArray(sortKey)) {
    sort = sortKey.map((key) => {
      const sortField = key.replace(/^[+-]/, '');
      return { [sortField]: { order: key.startsWith('-') ? 'desc' : 'asc' } };
    });
  } else {
    sort = [{ timestamp: { order: 'desc' } }];
  }

  return sort;
};

const defaultESScrollSize = 1000;
const defaultESScrollDuration = '6m';

const granuleSortParams = { sort: [{ timestamp: 'desc' }, { _uid: 'asc' }] };

module.exports = {
  defaultESScrollSize,
  defaultESScrollDuration,
  granuleSortParams,
};

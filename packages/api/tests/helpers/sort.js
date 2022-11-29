/**
 * Helper function for sorting a list of file objects by bucket
 *
 * @param {Object} f1 -- File object
 * @param {Object} f2 -- File object to compare to the first
 * @returns {Array} -- Sorted list of file objects
 **/
const sortFilesByBuckets = (f1, f2) => (
  (f1.bucket > f2.bucket) ? 1 : ((f2.bucket > f1.bucket) ? -1 : 0)
);

const sortFilesByKey = (f1, f2) => (
  (f1.key > f2.key) ? 1 : ((f2.key > f1.key) ? -1 : 0)
);

exports.sortFilesByBuckets = sortFilesByBuckets;
exports.sortFilesByKey = sortFilesByKey;

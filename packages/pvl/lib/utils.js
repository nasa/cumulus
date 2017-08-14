'use strict';

module.exports = {
  checkRegexes: (value, regexes) => {
    const matched = regexes.reduce(
      (alreadyFound, r) => alreadyFound || value.match(r),
      null
    );
    return (matched !== null ? matched[1] : null);
  },

  areIDsSame: (a, b) => {
    return a === b;
  }
};

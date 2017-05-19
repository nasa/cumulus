'use strict';

// The regexes here are so convoluted. They're really tied to specific GIBS id styles.
// There's no good way to know which part is absolutely the collection id and which part is the
// granule id
const withGranuleIdRegex = /^(?:[^\-^_]+-)?([A-Z0-9_]+)-([A-Z0-9_]+)-[a-z0-9\-]+$/;
const withoutGranuleIdRegex = /^([A-Z0-9_]+)-.+$/;

// let name;
// // without granules
// name = 'VNGCR_LQD_C1-000a89dd-6f3c-4876-928e-ab6736fd98e6';
// name = 'MOPITT_DCOSMR_LL_D_STD-2017-04-19_17_19_01';
// name = 'MOPITT_DCOSMR_LL_D_STD-20402140-0056-4b65-bb9d-8f3055d3dd7c';
//
// // with granules
// name = 'VIIRS-VNGCR_LQD_C1-2017126-e9792534-8721-40c4-b4fe-f046c5e4376b';
//
// name.match(withGranuleIdRegex)
// name.match(withoutGranuleIdRegex)

module.exports = {
  parseExecutionName: (name) => {
    // What is the first thing and are the following true?
    // example name: 'VIIRS-VNGCR_LQD_C1-2017126-e9792534-8721-40c4-b4fe-f046c5e4376b';
    // Parts of the name
    // 1. ...
    // 2. collection_id: does not contain -
    // 3. granule_id: does not contain -
    // 4. guid
    let matchResult = name.match(withGranuleIdRegex);
    if (!matchResult) {
      // If the granule id isn't in it then it may just have the collection id followed by a guid
      // Example: VNGCR_LQD_C1-000a89dd-6f3c-4876-928e-ab6736fd98e6
      // Another  MOPITT_DCOSMR_LL_D_STD-2017-04-19_17_19_01
      matchResult = name.match(withoutGranuleIdRegex);
      if (!matchResult) {
        throw new Error(`Found invalid execution name: ${name}`);
      }
    }
    const [_, collectionId, granuleId] = matchResult;
    return { collectionId, granuleId };
  }
};

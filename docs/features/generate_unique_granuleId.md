---
id: generate_unique_granuleId
title: Generate Unique GranuleId
hide_title: false
---

The `generateUniqueGranuleId` function of the `ingest` package is used during the `parse-pdr` and `addUniqueGranuleId` tasks to
create a new granuleId for a granule based on the hash scheme which the user did or did not configure in the appropriate task config.
The purpose of the function is to take the parameters `id` which maps to the granule's producerGranuleId (or original granuleId), `collectionId`
and two other optional variables: `hashLength`, which is the length of the MD5 hash being generated and appended to the newly uniquified ID, and
`includeTimestampHashKey` which discerns whether or not the hash will use `id` + `collectionId` or `id` + `collectionId` + timestamp. The new `producerGranuleId`
value for these granules' will be its original `id` of the granules' input payload.

## Hash used

The hash scheme used to generate the hash appended to the `id` is based on MD5 due to being faster than some of the other options (SHA/crypto) and cross-language portable without much extra implementation or changes. The generated hash buffer value is converted into a base64 encoded string value, removed of any prohibited characters (such as `_`), and appended to the original `id` after being trimmed using the `hashLength` value (since the MD5 generated hash value is 128 bits long).

## Configurable values explained

For the tasks that use this function, so far being `parse-pdr` and `addUniqueGranuleId`, the values for `hashLength` and `includeTimestampHashKey` can be
configured in the task config. See [Parse PDR](../workflow_tasks/parse_pdr) and [Add Unique GranuleId](../workflow_tasks/add_unique_granuleId) for more details.

### HashLength

Hashlength will be the desired length of the hash that is being appended to the original granuleId. For example if `hashLength` is set to `3`, when the
`generateUniqueGranuleId` function is ran, the returned `granuleId` would be `<granule_id>_<random string value of length 3>` (if the `id` is `MOD.GRANULE`, a possible
output could be `MOD.GRANULE_a1q`, with the uniquified hash value being the `a1q` which has a length of 3). By default, when this value is not set in the task config, it will be `8`.

### IncludeTimestampHashKey

IncludeTimestampHashKey is a boolean value which decides whether the hash string being appended will be generated using the `id` + `collectionId` solely, or with `id` +
`collectionId` + timestamp. If this value is set to false, then duplicates within the same collection will not be uniquified and will collide, as they have the same `id` and `collectionId`, the hash value would be the same no matter how many times the `generateUniqueGranuleId` function is ran with the original `id` and `collectionId`. In this option, duplicate granules (granules with the same producerGranuleId `id` values) across collections are supported, but not within the same collection. If the value
is set to true, then all granules, duplicates in the same collection or in different collections, will be uniquified and supported. Since timestamp is included in the hash, all new `granuleIds` will be uniquified and have a less than 0.1% chance of colliding with other duplicates.

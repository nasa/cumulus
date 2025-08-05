---
id: generate_unique_granuleId
title: Generate Unique GranuleId
hide_title: false
---

## Background

As a part of ECS decommissioning, the Cumulus system needs to be able to handle duplicate granules within and across collections.
This document focuses on a specific function, `generateUniqueGranuleId`, used in several pre-ingest tasks for the purpose of
uniquifying `granuleIds` of a list of granules, while maintaining an identifier which can be used to identify duplicates (`producerGranuleId`).

## generateUniqueGranuleId function

The `generateUniqueGranuleId` function is used during the `addUniqueGranuleId` and other tasks such as `parse-pdr` to generate a new `granuleId`. The process relies on a hash scheme that the user configures in the respective task's configuration.

The function accepts the following parameters:

- `id`, which corresponds to the granule’s original `producerGranuleId` or `granuleId`.
- `collectionId`, which is used to group the granule.
- Two optional parameters:
  - `hashLength`, specifying the length of the MD5 hash that will be appended to the new granuleId.
  - `includeTimestampHashKey`, which determines whether the hash will be generated using `collectionId`, or with timestamp as well (i.e., `collectionId` + `timestamp`).

The result is a new unique `granuleId` in the format: `granuleId_hash`, which retains the original `id` from the granule’s input payload but adds uniqueness based on the configured hash scheme.

## Hash schema

The hash scheme used to generate the hash appended to the `id` is based on the MD5 hashing scheme due to being faster than some of the other options (SHA/crypto) and cross-language portable without much extra implementation or changes. The generated hash buffer value is converted into a base64 encoded string value, removed of any prohibited characters (such as `_`), trimmed using the `hashLength` value (since the MD5 generated hash value is 128 bits long), and appended to the original `id`.

## Configurable values explained

For the tasks that use this function, being `AddUniqueGranuleId` and `ParsePdr` etc, the values for `hashLength` and `includeTimestampHashKey` can be
configured in the task config. See [Parse PDR](../workflow_tasks/parse_pdr) and the content below for more details.

### HashLength

Hashlength will be the desired length of the hash that is being appended to the uniquified granuleId. For example if `hashLength` is set to `3`, when the
`generateUniqueGranuleId` function is ran, the returned `granuleId` would be `<id>_<random string value of length 3>` (if the `id`, the original `producerGranuleId` is `MOD.GRANULE`, a possible
output could be `MOD.GRANULE_a1q`, with the uniquified hash value being the `a1q` which has a length of 3). By default, when this value is not set in the task config, it will be `8`.

### IncludeTimestampHashKey

IncludeTimestampHashKey is a boolean that controls how the unique hash is generated in the `generateUniqueGranuleId` function:

- If `false`: The hash is based only on `collectionId`. This means:
  - Duplicates within the same collection will collide, as their hash will be identical.
  - Duplicates across different collections are supported.

- If `true`: The hash includes `collectionId` and a timestamp, ensuring:
  - All granules are uniquified, even duplicates in the same collection.
  - Collision risk is extremely low (less than 0.1%).

## Java and Python options

Provided below are code segments for `generateUniqueGranuleId` in both Java and Python in case users who are configuring ingest workflows want to use their own tooling compared to the `addUniqueGranuleId` or `parse-pdr` tasks. The code mimics the functionality of the `generateUniqueGranuleId` function, using the same hash and parameter values.

### Java

``` Java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

public class UniqueGranuleIdGeneratorNoSort {

   public static String generateUniqueGranuleId(String granuleId, String collectionId, int hashLength, boolean includeTimestampHashKey) {

       String jsonString;
       if (includeTimestampHashKey) {
         jsonString = String.format(
            "{\"granuleId\":\"%s\",\"collectionId\":\"%s\",\"timestamp\":\"%d\"}",
            granuleId,
            collectionId,
            System.nanoTime()
        );
       } else {
         jsonString = String.format(
            "{\"granuleId\":\"%s\",\"collectionId\":\"%s\"}",
            granuleId,
            collectionId,
        );
       }

       try {
           MessageDigest md5 = MessageDigest.getInstance("MD5");
           byte[] md5Digest = md5.digest(jsonString.getBytes(StandardCharsets.UTF_8));
           String base64url = Base64.getUrlEncoder().withoutPadding().encodeToString(md5Digest);
           String cleanBase64url = base64url.replace("_", "");
           String hashPart = cleanBase64url.substring(0, Math.min(hashLength, cleanBase64url.length()));
           return granuleId + "_" + hashPart;

       } catch (NoSuchAlgorithmException e) {
           throw new RuntimeException("MD5 algorithm not available", e);
       }
   }
}
```

### Python

``` Python
import json
import hashlib
import base64
import time

def generate_unique_granule_id(granule: dict, hash_length: int = 8, include_timestamp_in_hashkey: bool = False) -> str:
"""
 Generates a unique granule ID by appending a truncated MD5 hash of the granule object.

   Args:
       granule (dict): The granule object containing 'granuleId' and 'collectionId'.
       hash_length (int): Length of hash slice to append.
       include_timestamp_in_hashkey (bool): Boolean value for if hash should use timestamp

   Returns:
       str: Unique granule ID in format 'granuleId_hash'.
   """

    # Build payload similar to JS: granuleId, collectionId, timestamp
    if include_timestamp_in_hashkey:
        payload = {
            "granuleId": granule["granuleId"],
            "collectionId": granule["collectionId"],
            "timestamp": str(time.time_ns()), # nanosecond precision timestamp
        }
    else:
        payload = {
            "granuleId": granule["granuleId"],
            "collectionId": granule["collectionId"],
        }

   # Serialize payload, hash and encode
   json_string = json.dumps(payload, separators=(",", ":"), sort_keys=True)
   md5_digest = hashlib.md5(json_string.encode("utf-8")).digest()
   base64url_string = base64.urlsafe_b64encode(md5_digest).decode("utf-8")

   # Remove any '_' characters from hash
   base64url_clean = base64url_string.replace("_", "")

   hash_part = base64url_clean[:hash_length]

   return f"{granule['granuleId']}_{hash_part}"
```

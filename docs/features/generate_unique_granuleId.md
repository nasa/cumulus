---
id: generate_unique_granuleId
title: Generate Unique GranuleId
hide_title: false
---

The `generateUniqueGranuleId` function is the algorithim used during the `parse-pdr` and `addUniqueGranuleId` tasks to
create a new granuleId for a granule based on the hash scheme which the user configures in the appropriate task config.
The purpose of the function is to take the parameters `id`, which maps to the granule's `producerGranuleId` (or original `granuleId`), `collectionId`,
and two other optional variables: `hashLength`, which is the length of the MD5 hash being generated and appended to the newly uniquified granuleId, and
`includeTimestampHashKey` which discerns whether the hash will use `id` + `collectionId` or `id` + `collectionId` + timestamp. The new `producerGranuleId`
value for these granules' will be its original `id` of the granules' input payload.

## Hash used

The hash scheme used to generate the hash appended to the `id` is based on the MD5 hashing scheme due to being faster than some of the other options (SHA/crypto) and cross-language portable without much extra implementation or changes. The generated hash buffer value is converted into a base64 encoded string value, removed of any prohibited characters (such as `_`), trimmed using the `hashLength` value (since the MD5 generated hash value is 128 bits long), and appended to the original `id`.

## Configurable values explained

For the tasks that use this function, being `parse-pdr` and `addUniqueGranuleId`, the values for `hashLength` and `includeTimestampHashKey` can be
configured in the task config. See [Parse PDR](../workflow_tasks/parse_pdr) and the content below for more details.

### HashLength

Hashlength will be the desired length of the hash that is being appended to the new granuleId. For example if `hashLength` is set to `3`, when the
`generateUniqueGranuleId` function is ran, the returned `granuleId` would be `<id>_<random string value of length 3>` (if the `id`, the original `producerGranuleId` is `MOD.GRANULE`, a possible
output could be `MOD.GRANULE_a1q`, with the uniquified hash value being the `a1q` which has a length of 3). By default, when this value is not set in the task config, it will be `8`.

### IncludeTimestampHashKey

IncludeTimestampHashKey is a boolean that controls how the unique hash is generated in the `generateUniqueGranuleId` function:

- If `false`: The hash is based only on `id` and `collectionId`. This means:
  - Duplicates within the same collection will collide, as their hash will be identical.
  - Duplicates across different collections are supported.

- If `true`: The hash includes `id`, `collectionId`, and a timestamp, ensuring:
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

   public static String uniqueGranuleId(String granuleId, String collectionId, int hashLength, boolean includeTimestampHashKey) {

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

def unique_granule_id(granule: dict, hash_length: int = 8, include_timestamp_in_hashkey: bool = False) -> str:
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

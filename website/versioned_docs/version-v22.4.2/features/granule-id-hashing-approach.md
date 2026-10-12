---
id: granule-id-hashing-approach
title: Unique Granule ID Generation Strategy
---

## Unique Granule ID Generation Strategy

To ensure granule uniqueness within the system, especially in scenarios where a producer might ingest a granule with the same `granuleId` multiple times (e.g., retries or reprocessing), a unique ID is generated using an entropy expansion strategy.

The format for the unique granule ID is: `<producerId>_<hash>`

This approach makes the ID human-interpretable, as users can infer the original producer ID directly from the generated ID, while the appended hash guarantees uniqueness.

---

## Hash Generation

The appended hash is a truncated, Base64URL-encoded MD5 hash. The length of this hash can be configured depending on the expected number of duplicate `granuleId` ingests.

The hash input is the collectionId, optionally combined with a high-resolution timestamp, concatenated with an underscore.

The hashing process follows these steps:

1. Construct the hash input string as:
   - `<collectionId>_<timestamp>` if includeTimestampHashKey=true
   - `<collectionId>` if includeTimestampHashKey=false. (default)
2. Compute the MD5 digest of the UTF-8 encoded string.
3. Encode the MD5 digest using Base64URL (no padding).
4. Slice the resulting string to the configured hashLength.

    ***Important***:
By *default* the included generation code in @cumulus/ingest/granule.generateUniqueGranuleId used in both `ParsePDR` and `AddUniqueGranuleId` tasks sets configuration of the computed hash to not include `timestamp` and instead only compute a hash based on the `collectionId` to avoid duplicate re-ingest scenarios for ingest flows that utilize filenames for granule discovery instead of triggering workflows via messages/queues, as it's believed this would be the more frequently encountered scenario versus same-collection duplicative ID scenarios.

### Core Task Component Hash Value Configuration

For the tasks that use this approach (`AddUniqueGranuleId` and `ParsePdr`) the values for `hashLength` and `includeTimestampHashKey` can be
configured in the task config via `collection`, `rule` or any other message/workflow configuration hooks.

### HashLength

Hashlength will be the desired length of the hash that is being appended to the uniquified granuleId. For example if `hashLength` is set to `3`, when the
`generateUniqueGranuleId` function is ran, the returned `granuleId` would be `<id>_<random string value of length 3>` (if the `id`, the original `producerGranuleId`, is `MOD.GRANULE`, a possible
output could be `MOD.GRANULE_a1q`, with the uniquified hash value being the `a1q` which has a length of 3). By default, when this value is not set in the task config, it will be `8`.

### IncludeTimestampHashKey

IncludeTimestampHashKey is a boolean that controls how the unique hash is generated in the `generateUniqueGranuleId` function:

- If `false`: The hash is based only on `collectionId`. This means:
  - Duplicates within the same collection will collide, as their hash will be identical.
  - Duplicates across different collections are supported.

- If `true`: The hash includes `collectionId` and a timestamp, ensuring:
  - All granules are uniquified, even duplicates in the same collection.
  - Collision risk is extremely low (less than 0.1%).

---

## Benefits

- **Idempotency on Retry/Producer ID re-issue**: The inclusion of a high-resolution timestamp ensures that if an ingest fails and is retried or a granule is re-generated with the same producer identifier, a new unique hash will be generated, preventing collisions and allowing granule versioning.
- **Flexibility if same-collection versioning is not desired**:  GranuleIds can be distinct across collections while still allowing same-collection collisions.
- **Portability**: The use of MD5 and Base64URL is highly portable across languages and platforms, with standard library support in most environments.
- **Human Interpretability**: Users can easily identify the original producer ID from the unique granule ID.
- **Low Complexity**: The implementation is straightforward and relies on well-understood, common libraries.

---

## Collision Risk Analysis

The primary risk is a hash collision for ingests with the same producer ID. The probability of a collision is governed by the birthday problem. (For a detailed explanation, see [Birthday problem on Wikipedia](https://en.wikipedia.org/wiki/Birthday_problem).

Based on internal feature analysis, the collision risk for 10,000 ingests of granules with the same producer ID *when using timestamp in the hash value* is as follows:

| Hash Length (chars) | Distinct Values (6 bits per char) | % Collision Risk for 10K same-ID ingests |
| :------------------ | :-------------------------------- | :--------------------------------------- |
| 6                   | $2^{36}$                           | 0.07273311278%                           |
| 7                   | $2^{42}$                           | 0.001136861915%                          |
| 8                   | $2^{48}$                           | 0.00001776356682%                        |
| 9                   | $2^{54}$                           | 0.0000002775557562%                      |

A default **hash length of 8 characters** provides a low risk of collision for the expected scale, and configurability in that value should allow for any unexpected scenarios to be addressed.

## Reference Implementations

The following are reference implementations of the proposed function in Node.js, Python, and Java.   Please note the following caveats:

- These are for reference/demonstration of multi-language compatibility, be sure to validate / *use at your own risk*
- Timestamps will not be exact across implementations and/or systems

### Node.js

```javascript
import crypto from 'node:crypto';

/**
 * Generates a unique granule ID by appending a truncated MD5 hash of values from
 * a producer provided granule object
 *
 * @param id - An ID associated with the object to be hashed.  Likely the ID
 * assigned by the granule producer
 * @param collectionId - The api collection ID (name___version) associated with the granule
 * @param hashLength - The length of the hash to append to the granuleId.
 * @param includeTimestampHashKey - Boolean value for whether hash string should contain timestamp
 * @returns - A unique granule ID in the format: granuleId_hash.
 */
export function generateUniqueGranuleId(
  id: string, collectionId: string, hashLength: number, includeTimestampHashKey?: boolean
): string {
  // use MD5 to generate truncated hash of granule object
  const hashStringWithTimestamp = `${collectionId}_${process.hrtime.bigint().toString()}`;
  const hashStringWithoutTimestamp = `${collectionId}`;
  const hashString = includeTimestampHashKey ? hashStringWithTimestamp : hashStringWithoutTimestamp;
  const hashBuffer = crypto.createHash('md5').update(hashString).digest();
  return `${id}_${hashBuffer.toString('base64url').replace(/_/g, '').slice(0, hashLength)}`;
}
```

### python

```python
import hashlib
import base64
import time

def unique_granule_id(
    id: str,
    collection_id: str,
    hash_length: int,
    include_timestamp_hash_key: bool = False
) -> str:
    if include_timestamp_hash_key:
        hash_string = f"{collection_id}_{time.time_ns()}"
    else:
        hash_string = collection_id

    md5_digest = hashlib.md5(hash_string.encode("utf-8")).digest()
    # urlsafe + strip '=' padding to match Node's unpadded base64url
    base64url = base64.urlsafe_b64encode(md5_digest).decode("utf-8").rstrip("=")
    cleaned = base64url.replace("_", "")
    hash_part = cleaned[:hash_length]

    return f"{id}_{hash_part}"
  ```

### java

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

public class UniqueGranuleIdGenerator {
  public static String uniqueGranuleId(
      String id,
      String collectionId,
      int hashLength,
      boolean includeTimestampHashKey
  ) {
    try {
      final String hashString = includeTimestampHashKey
          ? collectionId + "_" + System.nanoTime()
          : collectionId;

      final MessageDigest md5 = MessageDigest.getInstance("MD5");
      final byte[] digest = md5.digest(hashString.getBytes(StandardCharsets.UTF_8));

      // URL-safe Base64 without '=' padding, same alphabet as Node's 'base64url'
      final String base64url = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
      final String cleaned = base64url.replace("_", "");
      final String hashPart = cleaned.substring(0, Math.min(hashLength, cleaned.length()));

      return id + "_" + hashPart;
    } catch (NoSuchAlgorithmException e) {
      throw new RuntimeException("MD5 algorithm not available", e);
    }
  }
}
```

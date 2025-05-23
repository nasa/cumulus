#!/bin/bash
AVA="../../node_modules/.bin/ava"

echo "Running API performance tests";

### Performance test to validate write granules can handle granule concurrency with 1GB memory
$AVA "--max-old-space-size=1024" ./tests/performance/lib/test-write-granules.js

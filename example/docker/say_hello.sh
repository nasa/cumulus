#!/bin/bash
echo Waking up from nap...
stress --cpu  1 --vm-bytes 256M --timeout 120
echo Hello World

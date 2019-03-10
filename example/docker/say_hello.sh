#!/bin/bash
echo Waking up from nap...
stress --cpu 2 -m 4 --vm-bytes 1024M --timeout 120
echo Hello World

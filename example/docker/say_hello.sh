#!/bin/bash
echo Waking up from nap...
# TODO(aimee): Make this configurable (and pass in values in workflow payload)
stress --cpu 2 -m 4 --vm-bytes 1024M --timeout 120
echo Hello World

#!/bin/bash
echo Waking up from nap...
stress --cpu $1 -m $2 --vm-bytes ${3}M --timeout $4
echo Hello World

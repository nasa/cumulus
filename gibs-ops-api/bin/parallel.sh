#!/bin/bash
# Call this with a set of arguments of commands to run in parallel. It will run them and wait for
# all to complete. Killing the outer script will kill all of the running commands.

for cmd in "$@"; do {
  echo "Process \"$cmd\" started";
  $cmd & pid=$!
  PID_LIST+=" $pid";
} done

trap "kill $PID_LIST" SIGINT

echo "Parallel processes have started";

wait $PID_LIST

echo
echo "All processes have completed";

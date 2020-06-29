#!/bin/sh


# Notes
#
# - Alireza's explicitly added here because his git commits used "scisco" rather
#   than his full name
# - The `egrep -v` toward the end is handling mispellings and double-listed
#   contributors.

cat > CONTRIBUTORS.md <<EOS
# Cumulus Contributors

EOS

(
  echo 'Alireza Jazayeri'
  git log |\
    egrep '^Author:' |\
    sed -e 's/^Author: //' -e 's/ <.*//' |\
    grep ' ' |\
    sort |\
    uniq
) |\
  egrep -v '(Marourane|Philip Osip)' |\
  sed  -e 's/^\(.*\)$/* \1/' >> CONTRIBUTORS.md

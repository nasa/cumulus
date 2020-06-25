#!/bin/sh

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

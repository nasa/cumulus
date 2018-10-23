#!/bin/sh

set -e

specName=$(echo $2 | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)
outputPath="$1/$specName.txt"

echo $(date "+%Y%m%d-%H:%M:%S") run test $2 and output to $outputPath

jasmine $2 > $outputPath
result=$?

echo $(date "+%Y%m%d-%H:%M:%S") test $2 complete

exit $result

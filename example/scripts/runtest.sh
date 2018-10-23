#!/bin/sh

set -e

specName=$(echo $2 | rev | cut -d'/' -f 1 | cut -d'.' -f 2 | rev)
outputPath="$1/$specName.txt"

echo run test $2 and output to $outputPath

jasmine $2 > $outputPath

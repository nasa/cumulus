#!/bin/sh

set -evx

curl "https://s3.amazonaws.com/aws-cli/awscli-bundle.zip" -o "awscli-bundle.zip"
unzip awscli-bundle.zip
mkdir -p ~/bin
./awscli-bundle/install -b ~/bin/aws

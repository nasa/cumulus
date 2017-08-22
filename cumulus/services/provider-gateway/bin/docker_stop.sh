#!/bin/bash

line=$(docker container ls -a -f name=provider-gateway | tail -n 1)
docker kill provider-gateway
parts=($line)
id=${parts[0]}
docker rm "$id"
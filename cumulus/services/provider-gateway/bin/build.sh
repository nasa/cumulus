#!/bin/bash

lein uberjar
docker build -t nasa-cumulus/provider-gateway .

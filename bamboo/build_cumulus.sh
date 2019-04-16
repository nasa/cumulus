#!/bin/bash
echo "Running in the script"
npm install
npm run-script bootstrap
npm run-script build
echo "Done running the script"
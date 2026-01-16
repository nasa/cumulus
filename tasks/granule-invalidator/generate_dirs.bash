#!/bin/bash

# Script to generate standard task directory structure

TARGET_DIR="."

# Create all directories
mkdir -p "$TARGET_DIR"/{bin,src/python_reference_task,deploy,tests/integration_tests,tests/unit_tests/python_reference_task}

echo "Directory structure created at: $TARGET_DIR"
# ----------------------------
# Variables
# ----------------------------
DIST_DIR ?= dist
OPERA_DIR := $(DIST_DIR)/opera

PYTHON := python3
PIP := pip3

# Source directories
BASE_DEP_SRC := base_dependency_layer
LAMBDA_SRC := lambdas

# Build directories
BASE_DEP_BUILD := $(OPERA_DIR)/base_dependency_layer
OPERA_DEP_BUILD := $(OPERA_DIR)/opera_dependency_layer
LAMBDA_BUILD := $(OPERA_DIR)/opera_lambdas

# Zip outputs (must match Terraform)
BASE_DEP_ZIP := $(OPERA_DIR)/base_dependency_layer.zip
OPERA_DEP_ZIP := $(OPERA_DIR)/opera_dependency_layer.zip
LAMBDA_ZIP := $(OPERA_DIR)/opera_lambdas.zip

.PHONY: all build base deps lambdas clean

# ----------------------------
# Top-level
# ----------------------------
all: build

build: base deps lambdas

# ----------------------------
# Base dependency layer
# ----------------------------
base:
	rm -rf $(BASE_DEP_BUILD)
	mkdir -p $(BASE_DEP_BUILD)
	cp -R $(BASE_DEP_SRC)/python $(BASE_DEP_BUILD)/python
	cd $(BASE_DEP_BUILD) && zip -r ../base_dependency_layer.zip .


# ----------------------------
# Opera dependency layer
# ----------------------------
deps:
	rm -rf $(OPERA_DEP_BUILD)
	mkdir -p $(OPERA_DEP_BUILD)/python
	$(PIP) install -r lambdas/opera_dependency_layer/python/requirements.txt -t $(OPERA_DEP_BUILD)/python
	cd $(OPERA_DEP_BUILD) && zip -r ../opera_dependency_layer.zip .

# ----------------------------
# Lambda code
# ----------------------------
lambdas:
	rm -rf $(LAMBDA_BUILD)
	mkdir -p $(LAMBDA_BUILD)
	cp -R $(LAMBDA_SRC)/opera_lambdas/* $(LAMBDA_BUILD)/
	cd $(LAMBDA_BUILD) && zip -r ../opera_lambdas.zip .

# ----------------------------
# Cleanup
# ----------------------------
clean:
	rm -rf $(DIST_DIR)

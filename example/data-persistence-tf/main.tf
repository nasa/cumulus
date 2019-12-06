variable "prefix" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

terraform {
  required_providers {
    aws = ">= 2.31.0"
  }
}

provider "aws" {
  region = var.aws_region
}

module "data_persistence" {
  source = "../../tf-modules/data-persistence"

  prefix                     = var.prefix
  subnet_ids                 = var.subnet_ids
}

output "dynamo_tables" {
  value = module.data_persistence.dynamo_tables
}

output "elasticsearch_domain_arn" {
  value = module.data_persistence.elasticsearch_domain_arn
}

output "elasticsearch_hostname" {
  value = module.data_persistence.elasticsearch_hostname
}

output "elasticsearch_security_group_id" {
  value = module.data_persistence.elasticsearch_security_group_id
}

output "elasticsearch_alarms" {
  value = module.data_persistence.elasticsearch_alarms
}


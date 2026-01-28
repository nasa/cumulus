data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "terraform_remote_state" "cumulus" {
  backend   = "s3"
  workspace = var.PREFIX
  config    = local.cumulus_remote_state_config
}

data "aws_subnets" "subnet_ids" {
  filter {
    name = "tag:Name"
    values = ["Private application ${data.aws_region.current.name}a subnet",
    "Private application ${data.aws_region.current.name}b subnet"]
  }
}

data "aws_vpc" "application_vpcs" {
  tags = {
    Name = "Application VPC"
  }
}

resource "aws_security_group" "no_ingress_all_egress" {
  name   = "${var.PREFIX}-cumulus-tf-no-ingress-all-egress"
  vpc_id = data.aws_vpc.application_vpcs.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

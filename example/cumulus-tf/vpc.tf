data "aws_vpc" "application_vpc" {
  count = var.vpc_id == null ? 1 : 0
  tags = {
    Name = var.vpc_tag_name
  }
}

data "aws_subnets" "subnet_ids" {
  count = length(var.lambda_subnet_ids) == 0 ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [var.vpc_id != null ? var.vpc_id : data.aws_vpc.application_vpc[0].id]
  }
  filter {
    name   = "tag:Name"
    values = [var.subnets_tag_name]
  }
}

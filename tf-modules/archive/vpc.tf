resource "aws_security_group" "no_ingress_all_egress" {
  count = var.lambda_subnet_ids == null ? 0 : 1

  name   = "${var.prefix}-archive-no-ingress-all-egress"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.default_tags
}

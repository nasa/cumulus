# Deprecated: Retained temporarily as an empty provider stub so Terraform can
# destroy existing ORCA resources during a standard `terraform apply` to faciliate
# easy use in CI pipeline and for others.  Eventually this stub will be removed
# once the resource deletion has percolated through the system.
module "orca" {
  source = "./orca-deprecated"
  region = var.region
}

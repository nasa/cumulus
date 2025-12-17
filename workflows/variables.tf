variable "PREFIX" {
  type    = string
  default = "dms-opex-sbx"  # TODO: Update
}

variable "DIST_DIR" {
  type    = string
  default = "dist"
}

variable "MATURITY" {
  type    = string
  default = "sbx"
}

variable "workflow_max_receive_count" {
  type    = number
  default = 4
}

variable "download_host" {
  type    = string
  default = null
}

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

variable "bucket_config" {
  type = map(object({
    # NOTE: Type cannot be overridden for buckets. It only exists here to allow
    # additional buckets to be defined for a specific maturity only.
    type                 = optional(string)
    direct_read_access   = optional(list(string))
    earthdata_gis_access = optional(bool)
    intelligent_tiering  = optional(bool)
    logging              = optional(string)
    oai                  = optional(string)
  }))
  default     = {}
  description = "Maturity specific overrides for the base bucket config."
}

variable "bucket_config_base" {
  type = map(object({
    type                 = string
    direct_read_access   = optional(list(string))
    earthdata_gis_access = optional(bool)
    intelligent_tiering  = optional(bool)
    logging              = optional(string)
    oai                  = optional(string)
  }))
  default     = {}
  description = "Map of buckets to create. Each bucket has a config that can be used to set the bucket type and enable extra features on the bucket. Add new features here as necessary."
}

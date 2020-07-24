prefix = "mboyd-int-tf"
key_name      = "mboyd"
archive_api_port = 8000
elasticsearch_config = {
  domain_name    = "es"
  instance_count = 2
  instance_type  = "t2.small.elasticsearch"
  version        = "5.3"
  volume_size    = 10
}

cmr_oauth_provider = "launchpad"

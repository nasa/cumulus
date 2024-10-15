prefix = "cumulus-std"

elasticsearch_config = {
  domain_name    = "es"
  instance_count = 2
  instance_type  = "t2.small.elasticsearch"
  version        = "5.3"
  volume_type    = "gp2"
  volume_size    = 10
}

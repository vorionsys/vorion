# Vorion Staging Environment Variables
# Usage: terraform apply -var-file="staging.tfvars"

environment    = "staging"
region         = "us-east-1"
vpc_cidr       = "10.1.0.0/16"
cluster_name   = "vorion-staging"
cluster_version = "1.29"
db_instance_class = "db.t3.small"
redis_node_type   = "cache.t3.micro"

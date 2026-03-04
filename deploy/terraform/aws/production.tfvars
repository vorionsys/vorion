# Vorion Production Environment Variables
# Usage: terraform apply -var-file="production.tfvars"

environment    = "production"
region         = "us-east-1"
vpc_cidr       = "10.0.0.0/16"
cluster_name   = "vorion-cluster"
cluster_version = "1.29"
db_instance_class = "db.t3.medium"
redis_node_type   = "cache.t3.small"

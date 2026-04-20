variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-central-1"
}

variable "aws_access_key" {
  description = "AWS access key ID (prefer using ~/.aws/credentials or IAM role instead)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "aws_secret_key" {
  description = "AWS secret access key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "ssh_public_key" {
  description = "SSH public key content"
  type        = string
}

variable "cloud_init_template_path" {
  description = "Absolute path to the cloud-init template rendered by templatefile()"
  type        = string
}

variable "server_name" {
  description = "Instance name tag"
  type        = string
  default     = "golivekit-prod"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "ami_id" {
  description = "AMI ID (Ubuntu 24.04 LTS; leave empty to use the data source lookup)"
  type        = string
  default     = ""
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 30
}

variable "backups_enabled" {
  description = "Enable daily AWS Backup snapshots for the instance"
  type        = bool
  default     = false
}

variable "ipv4_enabled" {
  description = "Enable public IPv4"
  type        = bool
  default     = true
}

variable "ipv6_enabled" {
  description = "Enable public IPv6"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to resources"
  type        = map(string)
  default = {
    Environment = "production"
    App         = "golivekit"
  }
}

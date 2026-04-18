variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key content (e.g. contents of ~/.ssh/id_ed25519.pub)"
  type        = string
}

variable "cloud_init_template_path" {
  description = "Absolute path to the cloud-init template rendered by templatefile()"
  type        = string
}

variable "server_name" {
  description = "Droplet hostname"
  type        = string
  default     = "golivekit-prod"
}

variable "region" {
  description = "DigitalOcean region slug (https://slugs.do-api.dev)"
  type        = string
  default     = "fra1"
}

variable "size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "image" {
  description = "Droplet OS image slug"
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "backups_enabled" {
  description = "Enable weekly backups"
  type        = bool
  default     = false
}

variable "ipv4_enabled" {
  description = "Public IPv4 is always enabled for this module"
  type        = bool
  default     = true
}

variable "ipv6_enabled" {
  description = "Enable public IPv6"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to the Droplet"
  type        = list(string)
  default     = ["production", "app"]
}

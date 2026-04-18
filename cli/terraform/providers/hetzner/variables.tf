variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
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
  description = "Server hostname"
  type        = string
  default     = "golivekit-prod"
}

variable "location" {
  description = "Hetzner datacenter location (nbg1, fsn1, hel1, ash, hil, sin)"
  type        = string
  default     = "nbg1"
}

variable "server_type" {
  description = "Hetzner server type (cx22, cx32, cx42 …)"
  type        = string
  default     = "cx22"
}

variable "image" {
  description = "OS image name"
  type        = string
  default     = "ubuntu-24.04"
}

variable "backups_enabled" {
  description = "Enable automated backups (adds 20% to cost)"
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
  default     = true
}

variable "labels" {
  description = "Labels to apply to the server"
  type        = map(string)
  default = {
    env = "production"
    app = "golivekit"
  }
}

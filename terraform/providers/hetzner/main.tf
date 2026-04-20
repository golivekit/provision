terraform {
  required_version = ">= 1.5"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.0"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# ── SSH Key ───────────────────────────────────────────────────────────────────
resource "hcloud_ssh_key" "default" {
  name       = "${var.server_name}-key"
  public_key = var.ssh_public_key
  labels     = var.labels
}

# ── Cloud-init user data ──────────────────────────────────────────────────────
locals {
  user_data = templatefile(
    var.cloud_init_template_path,
    {
      ssh_public_key = var.ssh_public_key
      server_ip      = "PENDING"
    }
  )
}

# ── Server ────────────────────────────────────────────────────────────────────
resource "hcloud_server" "server" {
  name        = var.server_name
  server_type = var.server_type
  image       = var.image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.default.id]
  user_data   = local.user_data
  backups     = var.backups_enabled
  labels      = var.labels

  public_net {
    ipv4_enabled = var.ipv4_enabled
    ipv6_enabled = var.ipv6_enabled
  }

  lifecycle {
    precondition {
      condition     = var.ipv4_enabled || var.ipv6_enabled
      error_message = "At least one public IP version must be enabled."
    }
  }
}

# ── Firewall ──────────────────────────────────────────────────────────────────
# Inbound: only ports exposed by Traefik (docker-compose-prod.yml)
# Outbound: Docker image pulls, SMTP relay, DNS, NTP
resource "hcloud_firewall" "server" {
  name   = "${var.server_name}-firewall"
  labels = var.labels

  # ─ Inbound ────────────────────────
  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "SSH admin access"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "Traefik HTTP → HTTPS redirect"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "Traefik HTTPS (Next.js, dashboard, Adminer, Dozzle)"
  }

  # ─ Outbound ───────────────────────
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "443"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "HTTPS outbound (Docker pulls, API calls)"
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "80"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "HTTP outbound (apt, ACME)"
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "587"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "SMTP submission (Resend / SendGrid relay)"
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "465"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "SMTPS (alternative secure relay port)"
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "53"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "DNS"
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "123"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "NTP (time sync)"
  }

  rule {
    direction       = "out"
    protocol        = "icmp"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description     = "ICMP outbound"
  }
}

resource "hcloud_firewall_attachment" "server" {
  firewall_id = hcloud_firewall.server.id
  server_ids  = [hcloud_server.server.id]
}

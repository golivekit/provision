terraform {
  required_version = ">= 1.5"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

# ── SSH Key ───────────────────────────────────────────────────────────────────
# The CLI auto-imports this resource if the key already exists in DO,
# so Terraform never tries to create a duplicate.
resource "digitalocean_ssh_key" "default" {
  name       = "${var.server_name}-key"
  public_key = var.ssh_public_key
}

# ── Cloud-init user data ──────────────────────────────────────────────────────
locals {
  user_data = templatefile(
    var.cloud_init_template_path,
    {
      ssh_public_key = var.ssh_public_key
      server_ip      = "PENDING" # replaced after provisioning on first boot
    }
  )
}

# ── Droplet ───────────────────────────────────────────────────────────────────
resource "digitalocean_droplet" "server" {
  name      = var.server_name
  region    = var.region
  size      = var.size
  image     = var.image
  backups   = var.backups_enabled
  ipv6      = var.ipv6_enabled
  ssh_keys  = [digitalocean_ssh_key.default.fingerprint]
  user_data = local.user_data
  tags      = var.tags

  lifecycle {
    precondition {
      condition     = var.ipv4_enabled
      error_message = "DigitalOcean droplets always use IPv4 in this module. Keep ipv4_enabled set to true."
    }
  }
}

# ── Firewall ──────────────────────────────────────────────────────────────────
# Inbound: only ports exposed by Traefik (docker-compose-prod.yml)
#   All other services (Next.js :3000, Postgres :5432, Adminer :8080,
#   Dozzle :8080) are internal-only, routed through Traefik labels.
# Outbound: Docker image pulls (443), SMTP relay (587/465), DNS (53), NTP (123)
#   NOTE: DO blocks port 25 outbound on new accounts (anti-spam).
#         Use an SMTP relay (Resend/SendGrid) on port 587 or 465.
resource "digitalocean_firewall" "server" {
  name        = "${var.server_name}-firewall"
  droplet_ids = [digitalocean_droplet.server.id]

  # ─ Inbound ─────────────────────────────────────────────────────────────────
  inbound_rule {
    # SSH admin access
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    # Traefik HTTP → HTTPS redirect
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    # Traefik HTTPS: Next.js app, Traefik dashboard, Adminer, Dozzle
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # ─ Outbound ───────────────────────────────────────────────────────────────
  outbound_rule {
    # HTTPS: Docker Hub / GHCR image pulls, external API calls
    protocol              = "tcp"
    port_range            = "443"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # SMTP submission (transactional email relay: Resend, SendGrid, etc.)
    protocol              = "tcp"
    port_range            = "587"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # SMTPS (alternative secure SMTP relay port)
    protocol              = "tcp"
    port_range            = "465"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # HTTP (apt updates, Let's Encrypt HTTP-01 challenge if used)
    protocol              = "tcp"
    port_range            = "80"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # DNS
    protocol              = "udp"
    port_range            = "53"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # NTP (time sync)
    protocol              = "udp"
    port_range            = "123"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    # ICMP (ping, traceroute)
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

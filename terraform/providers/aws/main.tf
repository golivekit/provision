terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = var.aws_access_key != "" ? var.aws_access_key : null
  secret_key = var.aws_secret_key != "" ? var.aws_secret_key : null
}

# ── AMI lookup (Ubuntu 24.04 LTS) ─────────────────────────────────────────────
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_subnet" "selected" {
  id = tolist(data.aws_subnets.default.ids)[0]
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  ami_id             = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id
  selected_subnet_id = tolist(data.aws_subnets.default.ids)[0]
  selected_subnet_az = data.aws_subnet.selected.availability_zone
  selected_subnet_az_index = index(
    data.aws_availability_zones.available.names,
    data.aws_subnet.selected.availability_zone,
  )

  user_data = templatefile(
    var.cloud_init_template_path,
    {
      ssh_public_key = var.ssh_public_key
      server_ip      = "PENDING"
    }
  )

  common_tags = merge(var.tags, { Name = var.server_name })
}

# ── Key pair ──────────────────────────────────────────────────────────────────
resource "aws_key_pair" "default" {
  key_name   = "${var.server_name}-key"
  public_key = var.ssh_public_key
  tags       = local.common_tags
}

# ── Security Group ────────────────────────────────────────────────────────────
# Inbound: only ports exposed by Traefik (docker-compose-prod.yml)
#   All other services (Next.js :3000, Postgres :5432, Adminer :8080,
#   Dozzle :8080) are internal-only, routed through Traefik labels.
# NOTE: AWS blocks port 25 outbound by default on new accounts (anti-spam).
#       Request removal via AWS Support, or use SMTP relay on port 587/465.
resource "aws_security_group" "server" {
  name        = "${var.server_name}-sg"
  description = "GoLiveKit: SSH/HTTP/HTTPS inbound; SMTP relay + internet outbound"
  vpc_id      = data.aws_vpc.default.id
  tags        = local.common_tags

  # ── Inbound ─────────────────────────────────────────────────────────────────
  ingress {
    description      = "SSH admin access"
    from_port        = 22
    to_port          = 22
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  ingress {
    description      = "Traefik HTTP to HTTPS redirect"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  ingress {
    description      = "Traefik HTTPS - Next.js, Traefik dashboard, Adminer, Dozzle"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  # ── Outbound ─────────────────────────────────────────────────────────────────
  egress {
    description      = "HTTPS outbound - Docker Hub / GHCR image pulls, external APIs"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "HTTP outbound - apt package updates, ACME challenges"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "SMTP submission - transactional email relay: Resend, SendGrid"
    from_port        = 587
    to_port          = 587
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "SMTPS - alternative secure relay port"
    from_port        = 465
    to_port          = 465
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "DNS"
    from_port        = 53
    to_port          = 53
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "NTP (time sync)"
    from_port        = 123
    to_port          = 123
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }

  egress {
    description      = "ICMP outbound"
    from_port        = -1
    to_port          = -1
    protocol         = "icmp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
  }
}

resource "aws_vpc_ipv6_cidr_block_association" "default" {
  count  = var.ipv6_enabled ? 1 : 0
  vpc_id = data.aws_vpc.default.id
}

resource "aws_default_subnet" "selected" {
  count                           = var.ipv6_enabled ? 1 : 0
  availability_zone               = local.selected_subnet_az
  assign_ipv6_address_on_creation = true
  ipv6_cidr_block = cidrsubnet(
    aws_vpc_ipv6_cidr_block_association.default[0].ipv6_cidr_block,
    8,
    local.selected_subnet_az_index,
  )
}

# ── EC2 instance ──────────────────────────────────────────────────────────────
resource "aws_instance" "server" {
  ami                         = local.ami_id
  instance_type               = var.instance_type
  key_name                    = aws_key_pair.default.key_name
  subnet_id                   = var.ipv6_enabled ? aws_default_subnet.selected[0].id : local.selected_subnet_id
  vpc_security_group_ids      = [aws_security_group.server.id]
  user_data                   = local.user_data
  associate_public_ip_address = var.ipv4_enabled
  ipv6_address_count          = var.ipv6_enabled ? 1 : null

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    delete_on_termination = true
    encrypted             = true
  }

  tags = local.common_tags

  lifecycle {
    precondition {
      condition     = var.ipv4_enabled || var.ipv6_enabled
      error_message = "At least one public IP version must be enabled."
    }
  }
}

# ── Elastic IP ────────────────────────────────────────────────────────────────
resource "aws_eip" "server" {
  count    = var.ipv4_enabled ? 1 : 0
  instance = aws_instance.server.id
  domain   = "vpc"
  tags     = local.common_tags
}

data "aws_iam_policy_document" "backup_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      identifiers = ["backup.amazonaws.com"]
      type        = "Service"
    }
  }
}

resource "aws_iam_role" "backup" {
  count              = var.backups_enabled ? 1 : 0
  name               = "${var.server_name}-backup-role"
  assume_role_policy = data.aws_iam_policy_document.backup_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  count      = var.backups_enabled ? 1 : 0
  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_vault" "server" {
  count = var.backups_enabled ? 1 : 0
  name  = "${var.server_name}-backup-vault"
  tags  = local.common_tags
}

resource "aws_backup_plan" "server" {
  count = var.backups_enabled ? 1 : 0
  name  = "${var.server_name}-backup-plan"
  tags  = local.common_tags

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.server[0].name
    schedule          = "cron(0 3 * * ? *)"

    lifecycle {
      delete_after = 7
    }
  }
}

resource "aws_backup_selection" "server" {
  count        = var.backups_enabled ? 1 : 0
  iam_role_arn = aws_iam_role.backup[0].arn
  name         = "${var.server_name}-backup-selection"
  plan_id      = aws_backup_plan.server[0].id
  resources    = [aws_instance.server.arn]

  depends_on = [aws_iam_role_policy_attachment.backup]
}

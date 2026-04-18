#cloud-config
# Server bootstrap for GoLiveKit (docker-compose-prod.yml stack)
#
# Public ports (matching docker-compose-prod.yml):
#   22   -> SSH (admin access)
#   80   -> Traefik HTTP  (redirects to HTTPS)
#   443  -> Traefik HTTPS (Next.js app, Dozzle)
#
# Internal-only (no public port, routed via Traefik labels):
#   3000 -> Next.js app
#   5432 -> PostgreSQL
#   8080 -> Dozzle
#
# Outbound (allowed by default):
#   587 / 465 -> SMTP submission for transactional email (Resend, SendGrid, etc.)
#   443       -> Docker Hub / GHCR image pulls, external API calls
#   53  (UDP) -> DNS
#   123 (UDP) -> NTP
#
# Rendered by Terraform templatefile()

users:
  - name: deploy
    groups: [sudo, docker]
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${ssh_public_key}

package_update: true
package_upgrade: true

packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - gnupg
  - lsb-release
  - ufw
  - fail2ban
  - git
  - htop
  - unzip
  - jq

# -- Docker daemon config (log rotation) ----------------------------------------
write_files:
  - path: /etc/docker/daemon.json
    content: |
      {
        "log-driver": "json-file",
        "log-opts": {
          "max-size": "10m",
          "max-file": "5"
        }
      }

  - path: /etc/fail2ban/jail.local
    content: |
      [sshd]
      enabled  = true
      port     = ssh
      maxretry = 5
      bantime  = 3600

  - path: /etc/sysctl.d/60-golivekit-memory.conf
    content: |
      vm.swappiness=10
      vm.vfs_cache_pressure=50

  # Systemd unit so the docker-compose stack starts automatically on reboot
  - path: /etc/systemd/system/app.service
    content: |
      [Unit]
      Description=GoLiveKit App (docker compose)
      Requires=docker.service
      After=docker.service network-online.target

      [Service]
      User=deploy
      WorkingDirectory=/opt/app
      ExecStart=/usr/bin/docker compose --env-file .compose.env -f docker-compose-prod.yml up --remove-orphans
      ExecStop=/usr/bin/docker compose --env-file .compose.env -f docker-compose-prod.yml down
      Restart=always
      RestartSec=10

      [Install]
      WantedBy=multi-user.target

runcmd:
  # -- Docker CE + Compose plugin -------------------------------------------
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - |
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
  - apt-get update -y
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - systemctl enable docker
  - systemctl restart docker   # restart to pick up daemon.json (log rotation)

  # Verify both `docker` and `docker compose` are available
  - docker --version
  - docker compose version

  # -- Swap -----------------------------------------------------------------
  - |
    if ! swapon --show | grep -q .; then
      fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
  - sysctl --system
  - swapon --show

  # -- UFW firewall ---------------------------------------------------------
  # Inbound - only what Traefik exposes publicly
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp    comment "SSH"
  - ufw allow 80/tcp    comment "Traefik HTTP (-> HTTPS redirect)"
  - ufw allow 443/tcp   comment "Traefik HTTPS (Next.js / Dozzle)"
  # Outbound SMTP is covered by 'allow outgoing' above.
  # Port 25 is often blocked by cloud providers for new accounts;
  # use a relay (Resend / SendGrid) on port 587 or 465 instead.
  - ufw --force enable
  - ufw status verbose

  # -- fail2ban -------------------------------------------------------------
  - systemctl enable fail2ban
  - systemctl restart fail2ban

  # -- App directory --------------------------------------------------------
  - mkdir -p /opt/app
  - touch /opt/app/.compose.env
  - chown -R deploy:deploy /opt/app

  # -- Install app systemd service (enabled after the first real deploy) ----
  - systemctl daemon-reload

final_message: |
  > GoLiveKit server bootstrapped in $UPTIME seconds.

  Next steps:
    1. SSH in:  ssh deploy@${server_ip}
    2. Copy app files:
      scp .env docker-compose-prod.yml deploy@${server_ip}:/opt/app/
    3. Create /opt/app/.compose.env with REPO_OWNER_LC, REPO_NAME, IMAGE_TAG, DOMAIN, ACME_EMAIL, and TRAEFIK_AUTH_USERS
    4. Start the stack:
      ssh deploy@${server_ip} 'cd /opt/app && docker compose --env-file .compose.env -f docker-compose-prod.yml pull && docker compose --env-file .compose.env -f docker-compose-prod.yml up -d'
    5. Enable restart-on-boot after the first successful deploy:
      ssh deploy@${server_ip} 'sudo systemctl enable app.service'

  Public ports: 22 (SSH) * 80 (HTTP->HTTPS) * 443 (HTTPS)
  Swap: /swapfile (2G, swappiness=10)

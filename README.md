GoLiveKit website: https://golivekit.com/

# GoLiveKit Provision

Standalone Terraform provisioning CLI for DigitalOcean, Hetzner Cloud, and AWS EC2.

GitHub repository: https://github.com/golivekit/provision

## Prerequisites

| Tool | Install |
|---|---|
| [Node.js](https://nodejs.org) ≥ 18 | `brew install node` |
| [pnpm](https://pnpm.io) | `npm i -g pnpm` |
| [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.7 | `brew install terraform` |
| An SSH key pair | `ssh-keygen -t ed25519 -C "you@example.com"` |
| AWS CLI (required for AWS only) | `brew install awscli` |
| A cloud provider account & API token | see provider section below |

Published package: `@golivekit/provision`

## Quick start

```bash
# Run from npm
npx @golivekit/provision apply
npx @golivekit/provision plan --out ./infra
npx @golivekit/provision apply --out ./infra --cloud-init ./my-init.yaml
npx @golivekit/provision destroy --out ./infra

# Local development from this repo
cd cli
pnpm install
pnpm build
node ./dist/index.js apply
```

If `--out` is omitted, the CLI prompts for an output directory and defaults to `./provision-out`.
If `--cloud-init` is omitted, the CLI prompts for an optional custom template path and otherwise uses the bundled default.

The script will:
1. Ask which cloud provider to use
2. Load live provider options for locations, server types, and images
3. Ask for token or credentials, SSH key handling, server name, backup mode, and IPv4 or IPv6
4. Stage a provider workspace in your chosen output directory
5. Generate `terraform.tfvars` automatically
6. Run `terraform init`, show the plan, ask for confirmation, then apply

## Repository layout

```
.
├── cli/                          ← TypeScript CLI source
│   ├── package.json
│   ├── tsconfig.json
│   ├── terraform/                ← Bundled Terraform defaults published with the package
│   └── src/
│       ├── index.ts              ← entry point (apply / plan / destroy)
│       ├── providers/
│       │   ├── digitalocean.ts
│       │   ├── hetzner.ts
│       │   └── aws.ts
│       └── ...                   ← ui, prompts, ssh, terraform, tfvars helpers
└── .gitignore                    ← secrets & state are git-ignored
```

At runtime the CLI copies the provider defaults into `<out>/<provider>/` and runs Terraform there, so `terraform.tfvars`, state, and plan files stay project-scoped and portable.

Terraform source files live in `cli/terraform`. Update those files when you need to change the bundled provider defaults or cloud-init template.

## Provider setup

### DigitalOcean

1. Create an API token at <https://cloud.digitalocean.com/account/api/tokens>
2. Run `npx @golivekit/provision apply` and paste the token when prompted
3. Select an existing local public key or let the CLI generate a new one

Useful region slugs: `fra1` (Frankfurt), `ams3` (Amsterdam), `nyc3` (New York), `sfo3` (San Francisco), `sgp1` (Singapore)

### Hetzner Cloud

1. Create a project & API token at <https://console.hetzner.cloud>
2. Run `npx @golivekit/provision apply` and paste the token when prompted
3. Select an existing local public key or let the CLI generate a new one

Useful locations: `nbg1` (Nuremberg), `fsn1` (Falkenstein), `hel1` (Helsinki), `ash` (Ashburn VA), `sin` (Singapore)

### AWS EC2

1. Install and configure the AWS CLI, or prepare an IAM access key with EC2 permissions
2. Run `npx @golivekit/provision apply` and either provide the access key pair or reuse the configured AWS CLI credentials
3. Select an existing local public key or let the CLI generate a new one

The module provisions an **Elastic IP** so the server IP is stable across reboots.

AWS interactive discovery uses the AWS CLI to load the current regions, instance types, and Ubuntu 24.04 AMIs.

## What gets installed on the server

The bundled cloud-init template (`cli/terraform/modules/cloud-init/server-init.yaml.tpl`) runs on first boot:

- **Docker CE** + **Docker Compose plugin**
- **UFW** firewall — opens ports 22, 80, 443 only
- **fail2ban** — brute-force SSH protection
- **2 GB swapfile** at `/swapfile` with conservative kernel tuning (`vm.swappiness=10`)
- **`deploy` user** — passwordless sudo, added to the `docker` group
- `/opt/app` directory — ready for your docker-compose deployment, including a placeholder `.compose.env`

## Release

Tag pushes matching `v*.*.*` publish the package from `cli/`.

```bash
cd cli
pnpm version patch
git push --follow-tags
```

## Terraform state

By default state is stored locally in `<out>/<provider>/terraform.tfstate`.
For team use, migrate to a remote backend (Terraform Cloud, S3, etc.):

```hcl
# <out>/<provider>/main.tf
terraform {
  backend "s3" {
    bucket = "my-tf-state"
    key    = "golivekit/prod.tfstate"
    region = "eu-central-1"
  }
}
```

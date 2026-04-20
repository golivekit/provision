## Prerequisites

| Tool | Install |
|---|---|
| [Node.js](https://nodejs.org) ≥ 22 | `brew install node` |
| [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.7 | `brew install terraform` |
| A cloud provider account & API token | see provider section below |

## Quick start

```bash
# Provision a server — prompts guide you through every step
npx @golivekit/provision

# Provision to a custom output directory with a custom cloud-init template
npx @golivekit/provision --out ./infra --cloud-init ./my-init.yaml

# Preview the Terraform plan without applying
npx @golivekit/provision plan --out ./infra

# Tear down the provisioned infrastructure
npx @golivekit/provision destroy --out ./infra
```

`apply` is the default subcommand and can be omitted. `--out` defaults to `./provision-out`.

The CLI will:
1. Ask which cloud provider to use
2. Load live provider options for locations, server types, and images
3. Ask for token or credentials, SSH key handling, server name, backup mode, and IPv4 or IPv6
4. Stage a provider workspace in your chosen output directory
5. Generate `terraform.tfvars` automatically
6. Run `terraform init`, show the plan, ask for confirmation, then apply

## Provider setup

### DigitalOcean

1. Create an API token at <https://cloud.digitalocean.com/account/api/tokens>
2. Run `npx @golivekit/provision` and paste the token when prompted
3. Select an existing local public key or let the CLI generate a new one

Useful region slugs: `fra1` (Frankfurt), `ams3` (Amsterdam), `nyc3` (New York), `sfo3` (San Francisco), `sgp1` (Singapore)

### Hetzner Cloud

1. Create a project & API token at <https://console.hetzner.cloud>
2. Run `npx @golivekit/provision` and paste the token when prompted
3. Select an existing local public key or let the CLI generate a new one

Useful locations: `nbg1` (Nuremberg), `fsn1` (Falkenstein), `hel1` (Helsinki), `ash` (Ashburn VA), `sin` (Singapore)

### AWS EC2

#### 1. Create an IAM user

1. Open **IAM → Users → Create user** at <https://console.aws.amazon.com/iam/home#/users/create>
2. Set a username (e.g. `provision`) and click **Next**
3. Choose **Attach policies directly**, then click **Create policy**

#### 2. Create the IAM policy

In the policy editor switch to **JSON** and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PricingReadOnly",
      "Effect": "Allow",
      "Action": ["pricing:GetProducts"],
      "Resource": "*"
    },
    {
      "Sid": "STSValidate",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    },
    {
      "Sid": "EC2Describe",
      "Effect": "Allow",
      "Action": ["ec2:Describe*"],
      "Resource": "*"
    },
    {
      "Sid": "EC2Mutate",
      "Effect": "Allow",
      "Action": [
        "ec2:ImportKeyPair",
        "ec2:DeleteKeyPair",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StopInstances",
        "ec2:StartInstances",
        "ec2:ModifyInstanceAttribute",
        "ec2:AllocateAddress",
        "ec2:ReleaseAddress",
        "ec2:AssociateAddress",
        "ec2:DisassociateAddress",
        "ec2:AssociateVpcCidrBlock",
        "ec2:DisassociateVpcCidrBlock",
        "ec2:ModifySubnetAttribute",
        "ec2:CreateTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BackupsOptional",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "backup:CreateBackupVault",
        "backup:DeleteBackupVault",
        "backup:DescribeBackupVault",
        "backup:CreateBackupPlan",
        "backup:DeleteBackupPlan",
        "backup:GetBackupPlan",
        "backup:CreateBackupSelection",
        "backup:DeleteBackupSelection",
        "backup:GetBackupSelection"
      ],
      "Resource": "*"
    }
  ]
}
```

> The `BackupsOptional` block is only needed if you enable daily backup snapshots during setup. You can omit it otherwise.

Name the policy (e.g. `ProvisionEC2Policy`) and click **Create policy**.

#### 3. Attach the policy and get credentials

1. Back in the user creation flow, refresh the policy list, select `ProvisionEC2Policy`, and complete user creation
2. Open the user → **Security credentials → Create access key**
3. Choose **Other**, give it a description, and download the key

#### 4. Run the CLI

```bash
npx @golivekit/provision
```

Paste the **Access Key ID** and **Secret Access Key** when prompted. No AWS CLI required.

## What gets installed on the server

The bundled cloud-init template (`terraform/modules/cloud-init/server-init.yaml.tpl`) runs on first boot:

- **Docker CE** + **Docker Compose plugin**
- **UFW** firewall — opens ports 22, 80, 443 only
- **fail2ban** — brute-force SSH protection
- **2 GB swapfile** at `/swapfile` with conservative kernel tuning (`vm.swappiness=10`)
- **`deploy` user** — passwordless sudo, added to the `docker` group
- `/opt/app` directory — ready for your docker-compose deployment, including a placeholder `.compose.env`

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

---

## Local development

```bash
git clone git@github.com:golivekit/provision.git
cd provision
pnpm install
pnpm build
node ./dist/index.js
```

Terraform source files live in `terraform/`. Update those files when you need to change the bundled provider defaults or cloud-init template. At runtime the CLI copies the provider defaults into `<out>/<provider>/` and runs Terraform there, so `terraform.tfvars`, state, and plan files stay project-scoped and portable.

## Repository layout

```
.
├── package.json
├── tsconfig.json
├── terraform/                    ← Bundled Terraform defaults published with the package
│   ├── modules/
│   │   └── cloud-init/
│   │       └── server-init.yaml.tpl
│   └── providers/
│       ├── aws/
│       ├── digitalocean/
│       └── hetzner/
├── src/
│   ├── index.ts                  ← entry point (apply / plan / destroy)
│   ├── providers/
│   │   ├── digitalocean.ts
│   │   ├── hetzner.ts
│   │   └── aws.ts
│   └── ...                       ← ui, prompts, ssh, terraform, tfvars helpers
└── .gitignore                    ← secrets & state are git-ignored
```

## Release

Releases are fully automated via [Semantic Release](https://semantic-release.gitbook.io). Push to `main` with [Conventional Commits](https://www.conventionalcommits.org) and the CI will determine the version, publish to npm, create a GitHub release, and update `CHANGELOG.md` automatically.

| Commit prefix | Release type |
|---|---|
| `fix: ...` | patch (1.0.0 → 1.0.1) |
| `feat: ...` | minor (1.0.0 → 1.1.0) |
| `feat!: ...` / `BREAKING CHANGE:` | major (1.0.0 → 2.0.0) |

```bash
git commit -m "feat: add support for new provider"
git push origin main
```

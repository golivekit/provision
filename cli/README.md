GoLiveKit website: https://golivekit.com/
Deploy to VPS guide: https://golivekit.com/docs/deployment/docker-vps
# @golivekit/provision

Terraform provisioning CLI for DigitalOcean, Hetzner Cloud, and AWS EC2.

Repository: https://github.com/golivekit/provision

## Run

```bash
npx @golivekit/provision apply
npx @golivekit/provision plan --out ./infra
npx @golivekit/provision apply --out ./infra --cloud-init ./my-init.yaml
npx @golivekit/provision destroy --out ./infra
```

If `--out` is omitted, the CLI prompts for an output directory and defaults to `./provision-out`.
If `--cloud-init` is omitted, the CLI prompts for an optional custom template and otherwise uses the bundled default.

## Local development

```bash
cd cli
pnpm install
pnpm build
node ./dist/index.js apply
```

## Normal update flow

Use this when you want to push code to GitHub without publishing a new npm version.

```bash
git add .
git commit -m "your change"
git push
```

## Release flow

Use this only when you want to publish a new npm version.

```bash
cd cli
pnpm build
pnpm version patch
git push --follow-tags
```

Use one of these version commands depending on the release type:

```bash
pnpm version patch
pnpm version minor
pnpm version major
```

The GitHub Actions workflow publishes to npm only for tags matching `v*.*.*`, so regular commits do not publish anything.
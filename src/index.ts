#!/usr/bin/env node
import { checkDeps, checkProviderDeps } from './deps.js';
import { chooseProvider, readBool, readValue } from './prompts.js';
import {
  defaultOutDir,
  ensureProviderWorkspace,
  infraPath,
  resolveCloudInit,
  tfvarsExists,
} from './tfvars.js';
import {
  tfInit,
  tfPlan,
  tfApply,
  tfDestroy,
  clearStaleKnownHosts,
  showOutputs,
} from './terraform.js';
import { header, info, success, error, logo } from './ui.js';

import {
  configureDigitalOcean,
  writeDigitalOceanTfvars,
  importDigitalOceanSshKey,
} from './providers/digitalocean.js';
import {
  configureHetzner,
  writeHetznerTfvars,
  importHetznerSshKey,
} from './providers/hetzner.js';
import {
  configureAws,
  writeAwsTfvars,
  importAwsSshKey,
  importAwsSecurityGroup,
} from './providers/aws.js';

type Subcommand = 'apply' | 'plan' | 'destroy';

interface CliArgs {
  subcommand: Subcommand;
  outDir?: string;
  cloudInit?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let subcommand: Subcommand = 'apply';

  if (args[0] && !args[0].startsWith('--')) {
    const candidate = args.shift();
    if (candidate === 'apply' || candidate === 'plan' || candidate === 'destroy') {
      subcommand = candidate;
    } else {
      error(`Unknown subcommand: "${candidate}". Valid: apply (default), plan, destroy`);
    }
  }

  const parsed: CliArgs = { subcommand };

  while (args.length > 0) {
    const flag = args.shift();
    if (!flag) break;

    if (flag === '--out') {
      const value = args.shift();
      if (!value) error('Missing value for --out');
      parsed.outDir = value;
      continue;
    }

    if (flag === '--cloud-init') {
      const value = args.shift();
      if (!value) error('Missing value for --cloud-init');
      parsed.cloudInit = value;
      continue;
    }

    error(`Unknown flag: "${flag}". Valid: --out, --cloud-init`);
  }

  return parsed;
}

async function promptOutDir(initialValue?: string): Promise<string> {
  return readValue(
    'Output directory for Terraform state and tfvars?',
    initialValue ?? defaultOutDir(),
  );
}

async function promptCloudInit(initialValue?: string): Promise<string | undefined> {
  const value = await readValue(
    'Use custom cloud-init template? (leave blank for default)',
    initialValue,
  );
  return value.trim() ? value : undefined;
}

async function runApplyOrPlan(args: CliArgs): Promise<void> {
  logo();

  await checkDeps();

  const outDir = args.outDir ?? (await promptOutDir());
  const cloudInitPath = resolveCloudInit(
    args.cloudInit ?? (await promptCloudInit()),
  );

  const provider = await chooseProvider();
  await checkProviderDeps(provider);

  const dir = await ensureProviderWorkspace(provider, outDir);

  // Configure provider — always runs interactively, pre-fills from existing tfvars
  header(`Configuring ${provider}`);

  let sshKeyPath: string | undefined;

  if (provider === 'digitalocean') {
    const cfg = await configureDigitalOcean(outDir, cloudInitPath);
    await writeDigitalOceanTfvars(cfg, outDir);
    await tfInit(dir);
    await importDigitalOceanSshKey(cfg, outDir);
    sshKeyPath = cfg.sshKey.publicKeyPath.replace(/\.pub$/, '');
  } else if (provider === 'hetzner') {
    const cfg = await configureHetzner(outDir, cloudInitPath);
    await writeHetznerTfvars(cfg, outDir);
    await tfInit(dir);
    await importHetznerSshKey(cfg, outDir);
    sshKeyPath = cfg.sshKey.publicKeyPath.replace(/\.pub$/, '');
  } else {
    const cfg = await configureAws(outDir, cloudInitPath);
    await writeAwsTfvars(cfg, outDir);
    await tfInit(dir);
    await importAwsSshKey(cfg, cfg.region, outDir);
    await importAwsSecurityGroup(cfg, cfg.region, outDir);
    sshKeyPath = cfg.sshKey.publicKeyPath.replace(/\.pub$/, '');
  }

  await tfPlan(dir);

  if (args.subcommand === 'plan') {
    info('Plan complete (apply skipped in plan mode).');
    return;
  }

  const proceed = await readBool('Review the plan above. Apply?', true);
  if (!proceed) {
    info('Apply cancelled.');
    process.exit(0);
  }

  await tfApply(dir);
  const clearedHosts = await clearStaleKnownHosts(dir);
  await showOutputs(dir, sshKeyPath);

  success('Provisioning complete!');
  if (clearedHosts.length > 0) {
    info(
      `Removed stale SSH host key entries for: ${clearedHosts.join(', ')}`,
    );
  }
  info(
    'Note: cloud-init runs on first boot (~2 min). SSH may not be available immediately.',
  );
}

async function runDestroy(args: CliArgs): Promise<void> {
  logo();
  header('DESTROY');

  await checkDeps();

  const outDir = args.outDir ?? (await promptOutDir());
  const provider = await chooseProvider();
  const dir = await ensureProviderWorkspace(provider, outDir);

  const exists = await tfvarsExists(
    infraPath(outDir, provider, 'terraform.tfvars'),
  );
  if (!exists) {
    error(
      `No terraform.tfvars found for ${provider}. Run "provision apply" first to create it.`,
    );
  }

  await tfInit(dir);
  await tfDestroy(dir, provider);
  success('Resources destroyed.');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.subcommand === 'destroy') {
      await runDestroy(args);
    } else {
      await runApplyOrPlan(args);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('User force closed')) {
      // User pressed Ctrl+C — exit cleanly
      process.exit(130);
    }
    process.stderr.write(
      `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

main();

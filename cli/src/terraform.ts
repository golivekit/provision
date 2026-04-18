import { execa } from 'execa';
import { readBool } from './prompts.js';
import { info, success, warn, error } from './ui.js';
import type { Provider } from './types.js';

function tfArgs(dir: string, extra: string[]): [string, string[]] {
  return ['terraform', ['-chdir=' + dir, ...extra]];
}

export async function tfInit(dir: string): Promise<void> {
  info('Running terraform init...');
  const [cmd, args] = tfArgs(dir, ['init', '-upgrade']);
  await execa(cmd, args, { stdio: 'inherit' });
}

export async function tfPlan(dir: string): Promise<void> {
  info('Running terraform plan...');
  const [cmd, args] = tfArgs(dir, ['plan', '-out=tfplan']);
  await execa(cmd, args, { stdio: 'inherit' });
}

export async function tfApply(dir: string): Promise<void> {
  info('Applying terraform plan...');
  const [cmd, args] = tfArgs(dir, ['apply', 'tfplan']);
  try {
    await execa(cmd, args, { stdio: 'inherit' });
  } finally {
    // clean up plan file even if apply fails
    await execa('rm', ['-f', dir + '/tfplan']).catch(() => undefined);
  }
}

export async function tfDestroy(
  dir: string,
  provider: Provider,
): Promise<void> {
  warn(
    'This will DESTROY all resources managed by Terraform in this provider.',
  );
  const confirmed = await readBool(
    `Type "yes" to confirm destroy of ${provider} resources`,
    false,
  );
  if (!confirmed) {
    info('Destroy cancelled.');
    process.exit(0);
  }
  const [cmd, args] = tfArgs(dir, ['destroy', '-auto-approve']);
  await execa(cmd, args, { stdio: 'inherit' });
}

export async function tfImport(
  dir: string,
  resource: string,
  id: string,
): Promise<void> {
  // Skip if already in state — avoids "Resource already managed by Terraform" error
  try {
    const [showCmd, showArgs] = tfArgs(dir, ['state', 'show', resource]);
    await execa(showCmd, showArgs, { stdio: 'pipe' });
    info(`${resource} already in Terraform state — skipping import`);
    return;
  } catch {
    // not in state yet — proceed with import
  }

  info(`Importing existing resource: ${resource}`);
  const [cmd, args] = tfArgs(dir, ['import', resource, id]);
  await execa(cmd, args, { stdio: 'inherit' });
}

export async function showOutputs(
  dir: string,
  sshKeyPath?: string,
): Promise<void> {
  try {
    const [cmd, args] = tfArgs(dir, ['output']);
    const { stdout } = await execa(cmd, args);
    if (stdout.trim()) {
      info('Terraform outputs:');
      let out = stdout;
      if (sshKeyPath) {
        // Patch bare `ssh deploy@...` → `ssh -i <key> deploy@...`
        out = out.replace(/("ssh )(deploy@)/g, `$1-i ${sshKeyPath} $2`);
      }
      process.stdout.write(out + '\n');
    }
  } catch {
    // outputs not available yet — not an error
  }
}

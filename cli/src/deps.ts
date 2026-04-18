import { execa } from 'execa';
import { info, success, error } from './ui.js';
import type { Provider } from './types.js';

export async function checkDeps(): Promise<void> {
  const required = [
    {
      cmd: 'terraform',
      hint: 'brew install terraform  or  https://developer.hashicorp.com/terraform/install',
    },
    { cmd: 'ssh-keygen', hint: 'Install OpenSSH' },
  ];

  for (const { cmd, hint } of required) {
    try {
      await execa('which', [cmd]);
    } catch {
      error(`"${cmd}" not found. Install it first:\n     ${hint}`);
    }
  }

  const { stdout: tfVersion } = await execa('terraform', ['version', '-json']);
  try {
    const parsed = JSON.parse(tfVersion) as { terraform_version: string };
    success(`terraform ${parsed.terraform_version}`);
  } catch {
    success('terraform found');
  }
}

export async function checkProviderDeps(provider: Provider): Promise<void> {
  if (provider !== 'aws') return;

  try {
    await execa('which', ['aws']);
    info('aws CLI found');
  } catch {
    error(
      '"aws" CLI not found. Install it first:\n     brew install awscli  or  https://aws.amazon.com/cli/',
    );
  }
}

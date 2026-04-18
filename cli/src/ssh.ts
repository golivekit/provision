import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import { chooseFromOptions, readValue, select } from './prompts.js';
import type {} from './prompts.js';
import { info, success } from './ui.js';
import type { Provider, ProviderOption, SshKeyConfig } from './types.js';

/** Parse the comment/label from a .pub key file (last field after the key material). */
function parsePubKeyLabel(content: string): string {
  const parts = content.trim().split(/\s+/);
  return parts.length >= 3 ? parts.slice(2).join(' ') : parts[0];
}

/** Scan ~/.ssh/ for *.pub files and return them as ProviderOptions. */
async function collectLocalPublicKeys(): Promise<ProviderOption[]> {
  const sshDir = path.join(os.homedir(), '.ssh');
  let files: string[] = [];
  try {
    const entries = await readdir(sshDir);
    files = entries.filter((f: string) => f.endsWith('.pub'));
  } catch {
    return [];
  }

  const options: ProviderOption[] = [];
  for (const file of files) {
    const fullPath = path.join(sshDir, file);
    try {
      const content = await readFile(fullPath, 'utf8');
      const label = parsePubKeyLabel(content);
      options.push({ value: fullPath, label: `${file}  (${label})` });
    } catch {
      // skip unreadable files
    }
  }
  return options;
}

/** Generate a new ed25519 SSH keypair. Returns the public key path. */
async function generateSshKeypair(provider: Provider): Promise<string> {
  const timestamp = Date.now();
  const defaultPath = path.join(os.homedir(), '.ssh', `id_${provider}_${timestamp}`);
  const keyPath = await readValue('Path for new SSH key', defaultPath);

  await execa('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '']);
  success(`SSH keypair created: ${keyPath}`);
  return `${keyPath}.pub`;
}

/** Interactive flow: pick existing ~/.ssh/*.pub or generate a new keypair. */
export async function configureSshKey(provider: Provider): Promise<SshKeyConfig> {
  const existingKeys = await collectLocalPublicKeys();

  let method: 'existing' | 'new';

  if (existingKeys.length === 0) {
    info('No existing public keys found in ~/.ssh — will generate a new one');
    method = 'new';
  } else {
    method = await select<'existing' | 'new'>({
      message: 'SSH key',
      choices: [
        { name: 'Use an existing local public key', value: 'existing' },
        { name: 'Create a new SSH keypair', value: 'new' },
      ],
    });
  }

  let publicKeyPath: string;

  if (method === 'existing') {
    publicKeyPath = await chooseFromOptions('Select public key', existingKeys);
  } else {
    publicKeyPath = await generateSshKeypair(provider);
  }

  const publicKeyContent = (await readFile(publicKeyPath, 'utf8')).trim();
  success(`Using SSH key: ${path.basename(publicKeyPath)}`);
  return { publicKeyContent, publicKeyPath };
}

/** Compute the MD5 fingerprint of a public key (used by DigitalOcean). */
export async function sshKeyMd5Fingerprint(publicKeyPath: string): Promise<string> {
  const { stdout } = await execa('ssh-keygen', ['-l', '-E', 'md5', '-f', publicKeyPath]);
  // Output format: 2048 MD5:xx:yy:zz... label (type)
  const match = /MD5:([a-f0-9:]+)/i.exec(stdout);
  return match ? match[1] : stdout.trim();
}

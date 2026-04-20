import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Provider } from './types.js';

const DEFAULT_OUT_DIR = './provision-out';
const PROVIDER_WORKSPACE_FILES = new Set([
  'main.tf',
  'variables.tf',
  'outputs.tf',
  'terraform.tfvars.example',
]);

async function readRaw(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function tfvarsStringValue(
  filePath: string,
  key: string,
): Promise<string | null> {
  const content = await readRaw(filePath);
  if (!content) return null;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(content);
  return match ? match[1] : null;
}

export async function tfvarsBoolValue(
  filePath: string,
  key: string,
): Promise<boolean | null> {
  const content = await readRaw(filePath);
  if (!content) return null;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)`, 'm').exec(
    content,
  );
  if (!match) return null;
  return match[1] === 'true';
}

export async function tfvarsNumberValue(
  filePath: string,
  key: string,
): Promise<number | null> {
  const content = await readRaw(filePath);
  if (!content) return null;
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, 'm').exec(content);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export async function tfvarsExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function backupTfvars(filePath: string): Promise<void> {
  const bakPath = `${filePath}.bak`;
  try {
    await copyFile(filePath, bakPath);
  } catch {
    // no existing file to back up — that's fine
  }
}

export async function writeTfvars(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await backupTfvars(filePath);
  await writeFile(filePath, content, 'utf8');
}

function packagePath(...segments: string[]): string {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(dir, '..', ...segments);
}

export function defaultOutDir(): string {
  return DEFAULT_OUT_DIR;
}

export function resolveOutDir(outDir: string): string {
  return path.resolve(process.cwd(), outDir);
}

export function bundledTerraformPath(...segments: string[]): string {
  return packagePath('terraform', ...segments);
}

export function bundledProviderPath(
  provider: Provider,
  ...segments: string[]
): string {
  return bundledTerraformPath('providers', provider, ...segments);
}

export function infraPath(
  outDir: string,
  provider: Provider,
  ...segments: string[]
): string {
  return path.resolve(resolveOutDir(outDir), provider, ...segments);
}

export function resolveCloudInit(customPath?: string): string {
  if (customPath?.trim()) {
    return path.resolve(process.cwd(), customPath.trim());
  }
  return bundledTerraformPath('modules', 'cloud-init', 'server-init.yaml.tpl');
}

export async function ensureProviderWorkspace(
  provider: Provider,
  outDir: string,
): Promise<string> {
  const workspaceDir = infraPath(outDir, provider);
  const bundledDir = bundledProviderPath(provider);

  await mkdir(workspaceDir, { recursive: true });

  const bundledEntries = await readdir(bundledDir, { withFileTypes: true });
  for (const entry of bundledEntries) {
    if (!entry.isFile() || !PROVIDER_WORKSPACE_FILES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(bundledDir, entry.name);
    const targetPath = path.join(workspaceDir, entry.name);

    if (await tfvarsExists(targetPath)) {
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }

  return workspaceDir;
}

import { chooseFromOptions, readValue, readSecret, readBool } from '../prompts.js';
import { configureSshKey, sshKeyMd5Fingerprint } from '../ssh.js';
import { tfvarsStringValue, tfvarsBoolValue, writeTfvars, infraPath } from '../tfvars.js';
import { tfImport } from '../terraform.js';
import { info, success, error } from '../ui.js';
import type { DigitalOceanConfig, ProviderOption } from '../types.js';

const API = 'https://api.digitalocean.com/v2';

async function doFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    error(`DigitalOcean API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchRegions(token: string): Promise<ProviderOption[]> {
  info('Fetching DigitalOcean regions...');
  const data = await doFetch<{ regions: { slug: string; name: string; available: boolean }[] }>(token, '/regions');
  return data.regions
    .filter((r) => r.available)
    .map((r) => ({ value: r.slug, label: `${r.slug}  —  ${r.name}` }));
}

async function fetchSizes(token: string, region: string): Promise<ProviderOption[]> {
  info('Fetching DigitalOcean droplet sizes...');
  const data = await doFetch<{ sizes: { slug: string; vcpus: number; memory: number; price_monthly: number; available: boolean; regions: string[] }[] }>(token, '/sizes?per_page=200');
  return data.sizes
    .filter((s) => s.available && s.regions.includes(region))
    .sort((a, b) => a.price_monthly - b.price_monthly)
    .map((s) => ({
      value: s.slug,
      label: `${s.slug}  —  ${s.vcpus} vCPU / ${s.memory / 1024}GB RAM  ($${s.price_monthly}/mo)`,
    }));
}

async function fetchImages(token: string): Promise<ProviderOption[]> {
  info('Fetching DigitalOcean images...');
  const data = await doFetch<{ images: { slug: string | null; name: string; distribution: string }[] }>(token, '/images?type=distribution&per_page=100');
  return data.images
    .filter((i): i is typeof i & { slug: string } => i.slug !== null)
    .map((i) => ({ value: i.slug, label: `${i.slug}  —  ${i.distribution} ${i.name}` }));
}

export async function configureDigitalOcean(
  outDir: string,
  cloudInitTemplatePath: string,
): Promise<DigitalOceanConfig> {
  const tfvarsFile = infraPath(outDir, 'digitalocean', 'terraform.tfvars');

  // Auth
  const existingToken = await tfvarsStringValue(tfvarsFile, 'do_token');
  const token = await readSecret('DigitalOcean API token', existingToken ?? undefined);
  if (!token) error('API token is required');

  // SSH key
  const sshKey = await configureSshKey('digitalocean');

  // Server name
  const existingName = await tfvarsStringValue(tfvarsFile, 'server_name');
  const serverName = await readValue('Server name', existingName ?? 'golivekit-prod');

  // Region
  const regions = await fetchRegions(token);
  const existingRegion = await tfvarsStringValue(tfvarsFile, 'region');
  const region = await chooseFromOptions('Select region', regions, existingRegion ?? 'fra1');

  // Droplet size
  const sizes = await fetchSizes(token, region);
  const existingSize = await tfvarsStringValue(tfvarsFile, 'size');
  const size = await chooseFromOptions('Select droplet size', sizes, existingSize ?? 's-2vcpu-4gb');

  // Image
  const images = await fetchImages(token);
  const existingImage = await tfvarsStringValue(tfvarsFile, 'image');
  const image = await chooseFromOptions('Select image', images, existingImage ?? 'ubuntu-24-04-x64');

  // Options
  const existingBackups = await tfvarsBoolValue(tfvarsFile, 'backups_enabled');
  const backupsEnabled = await readBool('Enable weekly backups?', existingBackups ?? false);

  const existingMonitoring = await tfvarsBoolValue(tfvarsFile, 'monitoring_enabled');
  const monitoringEnabled = await readBool('Enable Monitoring? Improved Metrics and monitoring (Free)', existingMonitoring ?? true);

  const existingIpv6 = await tfvarsBoolValue(tfvarsFile, 'ipv6_enabled');
  const ipv6Enabled = await readBool('Enable IPv6?', existingIpv6 ?? true);

  return {
    token,
    sshKey,
    cloudInitTemplatePath,
    serverName,
    region,
    size,
    image,
    backupsEnabled,
    monitoringEnabled,
    ipv4Enabled: true,
    ipv6Enabled,
  };
}

export function buildDigitalOceanTfvars(cfg: DigitalOceanConfig): string {
  const escapeHcl = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `do_token       = "${escapeHcl(cfg.token)}"`,
    `ssh_public_key = "${escapeHcl(cfg.sshKey.publicKeyContent)}"`,
    `cloud_init_template_path = "${escapeHcl(cfg.cloudInitTemplatePath)}"`,
    `server_name     = "${escapeHcl(cfg.serverName)}"`,
    `region          = "${cfg.region}"`,
    `size            = "${cfg.size}"`,
    `image           = "${cfg.image}"`,
    `backups_enabled     = ${cfg.backupsEnabled}`,
    `monitoring_enabled  = ${cfg.monitoringEnabled}`,
    `ipv4_enabled        = ${cfg.ipv4Enabled}`,
    `ipv6_enabled        = ${cfg.ipv6Enabled}`,
    `tags            = ["production", "app"]`,
    '',
  ].join('\n');
}

export async function writeDigitalOceanTfvars(
  cfg: DigitalOceanConfig,
  outDir: string,
): Promise<void> {
  const tfvarsFile = infraPath(outDir, 'digitalocean', 'terraform.tfvars');
  await writeTfvars(tfvarsFile, buildDigitalOceanTfvars(cfg));
  success(`Written: ${tfvarsFile}`);
}

export async function importDigitalOceanSshKey(
  cfg: DigitalOceanConfig,
  outDir: string,
): Promise<void> {
  info('Checking if SSH key already exists in DigitalOcean...');

  const fingerprint = await sshKeyMd5Fingerprint(cfg.sshKey.publicKeyPath);
  const data = await doFetch<{ ssh_keys: { id: number; fingerprint: string }[] }>(cfg.token, '/account/keys');

  const existing = data.ssh_keys.find((k) => k.fingerprint === fingerprint);
  if (existing) {
    info(`SSH key found (id: ${existing.id}) — importing into Terraform state`);
    const dir = infraPath(outDir, 'digitalocean');
    await tfImport(dir, 'digitalocean_ssh_key.default', String(existing.id));
  }
}

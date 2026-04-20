import {
  chooseFromOptions,
  readValue,
  readSecret,
  readBool,
} from '../prompts.js';
import { configureSshKey } from '../ssh.js';
import {
  tfvarsStringValue,
  tfvarsBoolValue,
  writeTfvars,
  infraPath,
} from '../tfvars.js';
import { tfImport } from '../terraform.js';
import { info, success, error } from '../ui.js';
import type { HetznerConfig, ProviderOption } from '../types.js';

const API = 'https://api.hetzner.cloud/v1';

async function hclFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    error(`Hetzner API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchLocations(token: string): Promise<ProviderOption[]> {
  info('Fetching Hetzner locations...');
  const data = await hclFetch<{
    locations: {
      name: string;
      description: string;
      city: string;
      country: string;
      network_zone: string;
    }[];
  }>(token, '/locations');
  return data.locations.map((l) => ({
    value: l.name,
    label: `${l.name}  —  ${l.city}, ${l.country}  [${l.network_zone}]  (${l.description})`,
  }));
}

const SERVER_FAMILIES = [
  {
    value: 'cx',
    arch: 'x86',
    label: 'CX   —  x86 (Intel/AMD)  · Shared · Cost-optimised',
  },
  {
    value: 'cax',
    arch: 'arm',
    label: 'CAX  —  ARM64 (Ampere)   · Shared · Cost-optimised',
  },
  {
    value: 'cpx',
    arch: 'x86',
    label: 'CPX  —  x86 (AMD)        · Shared · Regular performance',
  },
  {
    value: 'ccx',
    arch: 'x86',
    label: 'CCX  —  x86 (AMD)        · Dedicated · General purpose',
  },
] as const;

type ServerFamilyValue = (typeof SERVER_FAMILIES)[number]['value'];

function familyToArch(family: ServerFamilyValue): string {
  return SERVER_FAMILIES.find((f) => f.value === family)?.arch ?? 'x86';
}

function typeToFamily(serverType: string): ServerFamilyValue {
  const match = SERVER_FAMILIES.slice()
    .sort((a, b) => b.value.length - a.value.length)
    .find((f) => serverType.toLowerCase().startsWith(f.value));
  return match?.value ?? 'cx';
}

async function fetchServerTypes(
  token: string,
  location: string,
  family: ServerFamilyValue,
): Promise<ProviderOption[]> {
  info('Fetching Hetzner server types...');
  const arch = familyToArch(family);
  const data = await hclFetch<{
    server_types: {
      name: string;
      description: string;
      cores: number;
      memory: number;
      disk: number;
      architecture: string;
      prices: { location: string; price_monthly: { gross: string } }[];
      deprecated: boolean;
      locations?: { name: string; available: boolean }[];
    }[];
  }>(token, '/server_types?per_page=100');
  return data.server_types
    .filter(
      (s) =>
        !s.deprecated &&
        s.architecture === arch &&
        s.name.toLowerCase().startsWith(family) &&
        // If the API doesn't return a locations array, don't exclude the type
        (!s.locations?.length ||
          s.locations.some((l) => l.name === location && l.available)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const locationPrice = s.prices.find((p) => p.location === location);
      const price =
        locationPrice?.price_monthly.gross ??
        s.prices[0]?.price_monthly.gross ??
        '?';
      return {
        value: s.name,
        label: `${s.name}  —  ${s.cores} vCPU / ${s.memory}GB RAM / ${s.disk}GB disk  (€${parseFloat(price).toFixed(2)}/mo)`,
      };
    });
}

async function fetchImages(
  token: string,
  architecture = 'x86',
): Promise<ProviderOption[]> {
  info('Fetching Hetzner images...');
  const data = await hclFetch<{
    images: {
      name: string;
      description: string;
      os_flavor: string;
      os_version: string | null;
      status: string;
      architecture: string;
    }[];
  }>(
    token,
    `/images?type=system&architecture=${encodeURIComponent(architecture)}&per_page=50`,
  );
  return data.images
    .filter((i) => i.status === 'available')
    .map((i) => ({
      value: i.name,
      label: `${i.name}  —  ${i.description}`,
    }));
}

export async function configureHetzner(
  outDir: string,
  cloudInitTemplatePath: string,
): Promise<HetznerConfig> {
  const tfvarsFile = infraPath(outDir, 'hetzner', 'terraform.tfvars');

  // Auth
  const existingToken = await tfvarsStringValue(tfvarsFile, 'hcloud_token');
  const token = await readSecret(
    'Hetzner Cloud API token',
    existingToken ?? undefined,
  );
  if (!token) error('API token is required');

  // SSH key
  const sshKey = await configureSshKey('hetzner');

  // Server name
  const existingName = await tfvarsStringValue(tfvarsFile, 'server_name');
  const serverName = await readValue(
    'Server name',
    existingName ?? 'golivekit-prod',
  );

  // Location
  const locations = await fetchLocations(token);
  const existingLocation = await tfvarsStringValue(tfvarsFile, 'location');
  const location = await chooseFromOptions(
    'Select location',
    locations,
    existingLocation ?? 'nbg1',
  );

  // Server family (architecture + performance tier)
  const existingType = await tfvarsStringValue(tfvarsFile, 'server_type');
  const defaultFamily: ServerFamilyValue = existingType
    ? typeToFamily(existingType)
    : 'cax';
  const family = (await chooseFromOptions(
    'Select server family',
    SERVER_FAMILIES.map((f) => ({ value: f.value, label: f.label })),
    defaultFamily,
  )) as ServerFamilyValue;

  // Server type
  const serverTypes = await fetchServerTypes(token, location, family);
  if (!serverTypes.length) {
    error(
      `No available server types found for family "${family}" in location "${location}".`,
    );
  }
  const defaultType = existingType?.startsWith(family)
    ? existingType
    : (serverTypes[0]?.value ?? `${family}11`);
  const serverType = await chooseFromOptions(
    'Select server type',
    serverTypes,
    defaultType,
  );
  const images = await fetchImages(token, familyToArch(family));
  const existingImage = await tfvarsStringValue(tfvarsFile, 'image');
  const image = await chooseFromOptions(
    'Select image',
    images,
    existingImage ?? 'ubuntu-24.04',
  );

  // Options
  const existingBackups = await tfvarsBoolValue(tfvarsFile, 'backups_enabled');
  const backupsEnabled = await readBool(
    'Enable backups? (adds ~20% to cost)',
    existingBackups ?? false,
  );

  const existingIpv4 = await tfvarsBoolValue(tfvarsFile, 'ipv4_enabled');
  const ipv4Enabled = await readBool('Enable IPv4?', existingIpv4 ?? true);

  const existingIpv6 = await tfvarsBoolValue(tfvarsFile, 'ipv6_enabled');
  const ipv6Enabled = await readBool('Enable IPv6?', existingIpv6 ?? true);

  if (!ipv4Enabled && !ipv6Enabled) {
    error('At least one of IPv4 or IPv6 must be enabled.');
  }

  return {
    token,
    sshKey,
    cloudInitTemplatePath,
    serverName,
    location,
    serverType,
    image,
    backupsEnabled,
    ipv4Enabled,
    ipv6Enabled,
  };
}

export function buildHetznerTfvars(cfg: HetznerConfig): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `hcloud_token   = "${esc(cfg.token)}"`,
    `ssh_public_key = "${esc(cfg.sshKey.publicKeyContent)}"`,
    `cloud_init_template_path = "${esc(cfg.cloudInitTemplatePath)}"`,
    `server_name     = "${esc(cfg.serverName)}"`,
    `location        = "${cfg.location}"`,
    `server_type     = "${cfg.serverType}"`,
    `image           = "${cfg.image}"`,
    `backups_enabled = ${cfg.backupsEnabled}`,
    `ipv4_enabled    = ${cfg.ipv4Enabled}`,
    `ipv6_enabled    = ${cfg.ipv6Enabled}`,
    `labels          = { env = "production", app = "golivekit" }`,
    '',
  ].join('\n');
}

export async function writeHetznerTfvars(
  cfg: HetznerConfig,
  outDir: string,
): Promise<void> {
  const tfvarsFile = infraPath(outDir, 'hetzner', 'terraform.tfvars');
  await writeTfvars(tfvarsFile, buildHetznerTfvars(cfg));
  success(`Written: ${tfvarsFile}`);
}

export async function importHetznerSshKey(
  cfg: HetznerConfig,
  outDir: string,
): Promise<void> {
  info('Checking if SSH key already exists in Hetzner Cloud...');

  const data = await hclFetch<{
    ssh_keys: { id: number; public_key: string }[];
  }>(cfg.token, '/ssh_keys');
  const normalise = (s: string) => s.trim().replace(/\s+/g, ' ');
  const existing = data.ssh_keys.find(
    (k) => normalise(k.public_key) === normalise(cfg.sshKey.publicKeyContent),
  );

  if (existing) {
    info(`SSH key found (id: ${existing.id}) — importing into Terraform state`);
    const dir = infraPath(outDir, 'hetzner');
    await tfImport(dir, 'hcloud_ssh_key.default', String(existing.id));
  }
}

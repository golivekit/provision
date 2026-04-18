import { execa } from 'execa';
import { chooseFromOptions, readValue, readSecret, readBool } from '../prompts.js';
import { configureSshKey } from '../ssh.js';
import { tfvarsStringValue, tfvarsBoolValue, tfvarsNumberValue, writeTfvars, infraPath } from '../tfvars.js';
import { tfImport } from '../terraform.js';
import { info, success, error } from '../ui.js';
import type { AwsConfig, ProviderOption } from '../types.js';

interface AwsCreds {
  accessKey: string;
  secretKey: string;
}

/** Run `aws` CLI with optional explicit credentials injected as env vars. */
async function awsCli(creds: AwsCreds, args: string[]): Promise<string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (creds.accessKey) env['AWS_ACCESS_KEY_ID'] = creds.accessKey;
  if (creds.secretKey) env['AWS_SECRET_ACCESS_KEY'] = creds.secretKey;
  const { stdout } = await execa('aws', args, { env });
  return stdout;
}

async function validateAwsCreds(creds: AwsCreds): Promise<void> {
  try {
    await awsCli(creds, ['sts', 'get-caller-identity']);
    success('AWS credentials validated');
  } catch {
    error('AWS credentials invalid or missing. Run "aws configure" or provide explicit keys.');
  }
}

async function fetchRegions(creds: AwsCreds): Promise<ProviderOption[]> {
  info('Fetching AWS regions...');
  const out = await awsCli(creds, ['ec2', 'describe-regions', '--output', 'json']);
  const data = JSON.parse(out) as { Regions: { RegionName: string; OptInStatus: string }[] };
  return data.Regions.filter((r) => r.OptInStatus !== 'not-opted-in').map((r) => ({
    value: r.RegionName,
    label: r.RegionName,
  }));
}

async function fetchInstanceTypes(creds: AwsCreds, region: string): Promise<ProviderOption[]> {
  info('Fetching EC2 instance types...');
  const out = await awsCli(creds, [
    'ec2', 'describe-instance-types',
    '--region', region,
    '--filters', 'Name=current-generation,Values=true',
    '--query', 'InstanceTypes[*].{type:InstanceType,vcpus:VCpuInfo.DefaultVCpus,mem:MemoryInfo.SizeInMiB}',
    '--output', 'json',
  ]);
  const items = JSON.parse(out) as { type: string; vcpus: number; mem: number }[];
  return items
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((i) => ({
      value: i.type,
      label: `${i.type}  —  ${i.vcpus} vCPU / ${(i.mem / 1024).toFixed(1)}GB RAM`,
    }));
}

async function fetchAmis(creds: AwsCreds, region: string): Promise<ProviderOption[]> {
  info('Fetching Ubuntu 24.04 AMIs...');
  const out = await awsCli(creds, [
    'ec2', 'describe-images',
    '--region', region,
    '--owners', 'amazon',
    '--filters',
    'Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*',
    'Name=state,Values=available',
    '--query', 'sort_by(Images,&CreationDate)[-20:][*].{id:ImageId,name:Name,date:CreationDate}',
    '--output', 'json',
  ]);
  const items = JSON.parse(out) as { id: string; name: string; date: string }[];
  return items
    .reverse()
    .map((i) => ({ value: i.id, label: `${i.id}  —  ${i.name}  (${i.date.slice(0, 10)})` }));
}

export async function configureAws(
  outDir: string,
  cloudInitTemplatePath: string,
): Promise<AwsConfig> {
  const tfvarsFile = infraPath(outDir, 'aws', 'terraform.tfvars');

  // Auth
  const existingAccessKey = await tfvarsStringValue(tfvarsFile, 'aws_access_key');
  const existingSecretKey = await tfvarsStringValue(tfvarsFile, 'aws_secret_key');

  info('Leave keys blank to use ~/.aws/credentials or IAM role');
  const accessKey = await readValue('AWS Access Key ID (blank = use profile)', existingAccessKey ?? '');
  const secretKey = accessKey
    ? await readSecret('AWS Secret Access Key', existingSecretKey ?? undefined)
    : '';

  const creds: AwsCreds = { accessKey, secretKey };
  await validateAwsCreds(creds);

  // SSH key
  const sshKey = await configureSshKey('aws');

  // Server name
  const existingName = await tfvarsStringValue(tfvarsFile, 'server_name');
  const serverName = await readValue('Server name', existingName ?? 'golivekit-prod');

  // Region
  const regions = await fetchRegions(creds);
  const existingRegion = await tfvarsStringValue(tfvarsFile, 'aws_region');
  const region = await chooseFromOptions('Select AWS region', regions, existingRegion ?? 'eu-central-1');

  // Instance type
  const instanceTypes = await fetchInstanceTypes(creds, region);
  const existingType = await tfvarsStringValue(tfvarsFile, 'instance_type');
  const instanceType = await chooseFromOptions('Select instance type', instanceTypes, existingType ?? 't3.small');

  // AMI
  const amis = await fetchAmis(creds, region);
  if (amis.length === 0) error(`No Ubuntu 24.04 AMIs found in region ${region}`);
  const existingAmi = await tfvarsStringValue(tfvarsFile, 'ami_id');
  const amiId = await chooseFromOptions('Select AMI (Ubuntu 24.04)', amis, existingAmi ?? amis[0].value);

  // Root volume size (preserve existing, no re-prompt)
  const rootVolumeSizeGb = (await tfvarsNumberValue(tfvarsFile, 'root_volume_size_gb')) ?? 30;

  // Options
  const existingBackups = await tfvarsBoolValue(tfvarsFile, 'backups_enabled');
  const backupsEnabled = await readBool('Enable daily AWS Backup snapshots?', existingBackups ?? false);

  const existingIpv4 = await tfvarsBoolValue(tfvarsFile, 'ipv4_enabled');
  const ipv4Enabled = await readBool('Enable public IPv4?', existingIpv4 ?? true);

  const existingIpv6 = await tfvarsBoolValue(tfvarsFile, 'ipv6_enabled');
  const ipv6Enabled = await readBool('Enable public IPv6?', existingIpv6 ?? false);

  if (!ipv4Enabled && !ipv6Enabled) {
    error('At least one of IPv4 or IPv6 must be enabled.');
  }

  return {
    accessKey,
    secretKey,
    sshKey,
    cloudInitTemplatePath,
    serverName,
    region,
    instanceType,
    amiId,
    rootVolumeSizeGb,
    backupsEnabled,
    ipv4Enabled,
    ipv6Enabled,
  };
}

export function buildAwsTfvars(cfg: AwsConfig): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `aws_access_key      = "${esc(cfg.accessKey)}"`,
    `aws_secret_key      = "${esc(cfg.secretKey)}"`,
    `ssh_public_key      = "${esc(cfg.sshKey.publicKeyContent)}"`,
    `cloud_init_template_path = "${esc(cfg.cloudInitTemplatePath)}"`,
    `aws_region          = "${cfg.region}"`,
    `server_name         = "${esc(cfg.serverName)}"`,
    `instance_type       = "${cfg.instanceType}"`,
    `ami_id              = "${cfg.amiId}"`,
    `root_volume_size_gb = ${cfg.rootVolumeSizeGb}`,
    `backups_enabled     = ${cfg.backupsEnabled}`,
    `ipv4_enabled        = ${cfg.ipv4Enabled}`,
    `ipv6_enabled        = ${cfg.ipv6Enabled}`,
    `tags                = { Environment = "production", App = "golivekit" }`,
    '',
  ].join('\n');
}

export async function writeAwsTfvars(
  cfg: AwsConfig,
  outDir: string,
): Promise<void> {
  const tfvarsFile = infraPath(outDir, 'aws', 'terraform.tfvars');
  await writeTfvars(tfvarsFile, buildAwsTfvars(cfg));
  success(`Written: ${tfvarsFile}`);
}

export async function importAwsSshKey(
  cfg: AwsConfig,
  region: string,
  outDir: string,
): Promise<void> {
  info('Checking if SSH key pair already exists in AWS...');
  const keyName = `${cfg.serverName}-key`;
  const creds: AwsCreds = { accessKey: cfg.accessKey, secretKey: cfg.secretKey };

  try {
    const out = await awsCli(creds, [
      'ec2', 'describe-key-pairs',
      '--region', region,
      '--key-names', keyName,
      '--output', 'json',
    ]);
    const data = JSON.parse(out) as { KeyPairs: { KeyName: string }[] };
    if (data.KeyPairs.length > 0) {
      info(`SSH key pair "${keyName}" found — importing into Terraform state`);
      const dir = infraPath(outDir, 'aws');
      await tfImport(dir, 'aws_key_pair.default', keyName);
    }
  } catch {
    // key doesn't exist — nothing to import
  }
}

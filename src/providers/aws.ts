import { EC2Client, DescribeRegionsCommand, DescribeInstanceTypesCommand, DescribeImagesCommand, DescribeKeyPairsCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { chooseFromOptions, readValue, readSecret, readBool } from '../prompts.js';
import { configureSshKey } from '../ssh.js';
import { tfvarsStringValue, tfvarsBoolValue, tfvarsNumberValue, writeTfvars, infraPath } from '../tfvars.js';
import { tfImport } from '../terraform.js';
import { info, success, warn, error } from '../ui.js';
import type { AwsConfig, ProviderOption } from '../types.js';

interface AwsCreds {
  accessKey: string;
  secretKey: string;
}

function makeEc2Client(creds: AwsCreds, region = 'us-east-1'): EC2Client {
  if (creds.accessKey && creds.secretKey) {
    return new EC2Client({
      region,
      credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey },
    });
  }
  return new EC2Client({ region });
}

function makeStsClient(creds: AwsCreds): STSClient {
  if (creds.accessKey && creds.secretKey) {
    return new STSClient({
      region: 'us-east-1',
      credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey },
    });
  }
  return new STSClient({ region: 'us-east-1' });
}

async function validateAwsCreds(creds: AwsCreds): Promise<void> {
  try {
    const sts = makeStsClient(creds);
    await sts.send(new GetCallerIdentityCommand({}));
    success('AWS credentials validated');
  } catch {
    error('AWS credentials invalid or missing. Check your access key or run "aws configure".');
  }
}

function makePricingClient(creds: AwsCreds): PricingClient {
  // Pricing API is only available in us-east-1
  if (creds.accessKey && creds.secretKey) {
    return new PricingClient({
      region: 'us-east-1',
      credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey },
    });
  }
  return new PricingClient({ region: 'us-east-1' });
}

// Maps region codes to the location names used by the Pricing API
const REGION_TO_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-west-3': 'Europe (Paris)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-north-1': 'Europe (Stockholm)',
  'eu-south-1': 'Europe (Milan)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'sa-east-1': 'South America (Sao Paulo)',
  'me-south-1': 'Middle East (Bahrain)',
  'af-south-1': 'Africa (Cape Town)',
};

async function fetchOnDemandPrices(
  creds: AwsCreds,
  region: string,
): Promise<Map<string, number>> {
  const location = REGION_TO_LOCATION[region];
  if (!location) return new Map();

  const pricing = makePricingClient(creds);
  const prices = new Map<string, number>();
  let nextToken: string | undefined;

  do {
    const res = await pricing.send(new GetProductsCommand({
      ServiceCode: 'AmazonEC2',
      Filters: [
        { Type: 'TERM_MATCH', Field: 'operatingSystem',  Value: 'Linux' },
        { Type: 'TERM_MATCH', Field: 'tenancy',           Value: 'Shared' },
        { Type: 'TERM_MATCH', Field: 'preInstalledSw',    Value: 'NA' },
        { Type: 'TERM_MATCH', Field: 'capacitystatus',    Value: 'Used' },
        { Type: 'TERM_MATCH', Field: 'location',          Value: location },
      ],
      NextToken: nextToken,
    }));
    nextToken = res.NextToken;

    for (const item of res.PriceList ?? []) {
      try {
        const doc = JSON.parse(item) as {
          product: { attributes: { instanceType: string } };
          terms: { OnDemand: Record<string, { priceDimensions: Record<string, { pricePerUnit: { USD: string } }> }> };
        };
        const instanceType = doc.product.attributes.instanceType;
        const onDemand = Object.values(doc.terms.OnDemand)[0];
        const dim = Object.values(onDemand.priceDimensions)[0];
        const usd = parseFloat(dim.pricePerUnit.USD);
        if (usd > 0) prices.set(instanceType, usd);
      } catch {
        // skip malformed entries
      }
    }
  } while (nextToken);

  return prices;
}

async function fetchRegions(creds: AwsCreds): Promise<ProviderOption[]> {
  info('Fetching AWS regions...');
  const ec2 = makeEc2Client(creds);
  const res = await ec2.send(new DescribeRegionsCommand({ AllRegions: false }));
  return (res.Regions ?? [])
    .filter((r) => r.OptInStatus !== 'not-opted-in' && r.RegionName)
    .map((r) => ({ value: r.RegionName!, label: r.RegionName! }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

async function fetchInstanceTypes(
  creds: AwsCreds,
  region: string,
): Promise<{ options: ProviderOption[]; archOf: Map<string, string> }> {
  info('Fetching EC2 instance types and prices...');
  const [typesRes, prices] = await Promise.all([
    makeEc2Client(creds, region).send(new DescribeInstanceTypesCommand({
      Filters: [{ Name: 'current-generation', Values: ['true'] }],
    })),
    fetchOnDemandPrices(creds, region).catch((e: unknown) => {
      warn(`Prices unavailable — add pricing:GetProducts to your IAM policy (${(e as Error).message})`);
      return new Map<string, number>();
    }),
  ]);

  const archOf = new Map<string, string>();
  const options = (typesRes.InstanceTypes ?? [])
    .filter((i) => i.InstanceType)
    .map((i) => {
      const vcpus = i.VCpuInfo?.DefaultVCpus ?? 0;
      const mem = i.MemoryInfo?.SizeInMiB ?? 0;
      const arch = i.ProcessorInfo?.SupportedArchitectures?.[0] ?? 'x86_64';
      archOf.set(i.InstanceType!, arch);
      const price = prices.get(i.InstanceType!);
      const priceStr = price != null ? `  $${price.toFixed(3)}/hr` : '';
      return {
        value: i.InstanceType!,
        label: `${i.InstanceType}  —  ${vcpus} vCPU / ${(mem / 1024).toFixed(1)} GB RAM${priceStr}`,
        vcpus,
        mem,
        price: price ?? Infinity,
      };
    })
    .sort((a, b) => a.price - b.price || a.vcpus - b.vcpus || a.mem - b.mem)
    .map(({ value, label }) => ({ value, label }));

  return { options, archOf };
}

async function fetchAmis(
  creds: AwsCreds,
  region: string,
  architecture = 'x86_64',
): Promise<ProviderOption[] | null> {
  const amiArch = architecture === 'arm64' ? 'arm64' : 'amd64';
  info(`Fetching Ubuntu 24.04 AMIs (${amiArch})...`);
  try {
    const ec2 = makeEc2Client(creds, region);
    const res = await ec2.send(new DescribeImagesCommand({
      Owners: ['amazon'],
      Filters: [
        { Name: 'name', Values: [`ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${amiArch}-server-*`] },
        { Name: 'architecture', Values: [architecture] },
        { Name: 'state', Values: ['available'] },
      ],
    }));
    const items = (res.Images ?? [])
      .filter((i) => i.ImageId && i.CreationDate)
      .sort((a, b) => b.CreationDate!.localeCompare(a.CreationDate!))
      .slice(0, 20);
    return items.map((i) => ({
      value: i.ImageId!,
      label: `${i.ImageId}  —  ${i.Name}  (${i.CreationDate!.slice(0, 10)})`,
    }));
  } catch (e) {
    warn(`Could not fetch AMIs — ${(e as Error).message}`);
    return null;
  }
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
  const existingRegion = await tfvarsStringValue(tfvarsFile, 'aws_region');
  const regions = await fetchRegions(creds);
  const region = await chooseFromOptions('Select AWS region', regions, existingRegion ?? 'eu-central-1');

  // Instance type
  const existingType = await tfvarsStringValue(tfvarsFile, 'instance_type');
  const { options: instanceTypes, archOf } = await fetchInstanceTypes(creds, region);
  const instanceType = await chooseFromOptions('Select instance type', instanceTypes, existingType ?? 't3.small');

  // AMI — fetch images matching the selected instance type's architecture
  const arch = archOf.get(instanceType) ?? 'x86_64';
  const amis = await fetchAmis(creds, region, arch);
  if (amis !== null && amis.length === 0) error(`No Ubuntu 24.04 AMIs found in region ${region}`);
  const existingAmi = await tfvarsStringValue(tfvarsFile, 'ami_id');
  const amiId = amis
    ? await chooseFromOptions('Select AMI (Ubuntu 24.04)', amis, existingAmi ?? amis[0].value)
    : await readValue('AMI ID (Ubuntu 24.04, e.g. ami-0abcdef1234567890)', existingAmi ?? '');

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
    const ec2 = makeEc2Client(creds, region);
    const res = await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [keyName] }));
    if ((res.KeyPairs ?? []).length > 0) {
      info(`SSH key pair "${keyName}" found — importing into Terraform state`);
      const dir = infraPath(outDir, 'aws');
      await tfImport(dir, 'aws_key_pair.default', keyName);
    }
  } catch {
    // key doesn't exist — nothing to import
  }
}

export async function importAwsSecurityGroup(
  cfg: AwsConfig,
  region: string,
  outDir: string,
): Promise<void> {
  info('Checking if security group already exists in AWS...');
  const sgName = `${cfg.serverName}-sg`;
  const creds: AwsCreds = { accessKey: cfg.accessKey, secretKey: cfg.secretKey };

  try {
    const ec2 = makeEc2Client(creds, region);
    const res = await ec2.send(new DescribeSecurityGroupsCommand({
      Filters: [{ Name: 'group-name', Values: [sgName] }],
    }));
    const sg = (res.SecurityGroups ?? [])[0];
    if (sg?.GroupId) {
      info(`Security group "${sgName}" found — importing into Terraform state`);
      const dir = infraPath(outDir, 'aws');
      await tfImport(dir, 'aws_security_group.server', sg.GroupId);
    }
  } catch {
    // security group doesn't exist — nothing to import
  }
}

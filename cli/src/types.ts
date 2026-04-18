export type Provider = 'digitalocean' | 'hetzner' | 'aws';

export interface ProviderOption {
  value: string;
  label: string;
}

export interface SshKeyConfig {
  publicKeyContent: string;
  publicKeyPath: string;
}

export interface DigitalOceanConfig {
  token: string;
  sshKey: SshKeyConfig;
  cloudInitTemplatePath: string;
  serverName: string;
  region: string;
  size: string;
  image: string;
  backupsEnabled: boolean;
  ipv4Enabled: boolean;
  ipv6Enabled: boolean;
}

export interface HetznerConfig {
  token: string;
  sshKey: SshKeyConfig;
  cloudInitTemplatePath: string;
  serverName: string;
  location: string;
  serverType: string;
  image: string;
  backupsEnabled: boolean;
  ipv4Enabled: boolean;
  ipv6Enabled: boolean;
}

export interface AwsConfig {
  accessKey: string;
  secretKey: string;
  sshKey: SshKeyConfig;
  cloudInitTemplatePath: string;
  serverName: string;
  region: string;
  instanceType: string;
  amiId: string;
  rootVolumeSizeGb: number;
  backupsEnabled: boolean;
  ipv4Enabled: boolean;
  ipv6Enabled: boolean;
}

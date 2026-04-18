import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(__dirname, '..');
const sourceTerraformDir = path.resolve(cliDir, '..', 'terraform');
const targetTerraformDir = path.resolve(cliDir, 'terraform');

const providerFiles = ['main.tf', 'variables.tf', 'outputs.tf', 'terraform.tfvars.example'];
const providers = ['aws', 'digitalocean', 'hetzner'];

async function syncTerraform() {
  await rm(targetTerraformDir, { recursive: true, force: true });

  await mkdir(path.join(targetTerraformDir, 'modules', 'cloud-init'), {
    recursive: true,
  });
  await copyFile(
    path.join(sourceTerraformDir, 'modules', 'cloud-init', 'server-init.yaml.tpl'),
    path.join(targetTerraformDir, 'modules', 'cloud-init', 'server-init.yaml.tpl'),
  );

  for (const provider of providers) {
    const targetProviderDir = path.join(targetTerraformDir, 'providers', provider);
    await mkdir(targetProviderDir, { recursive: true });

    for (const fileName of providerFiles) {
      await copyFile(
        path.join(sourceTerraformDir, 'providers', provider, fileName),
        path.join(targetProviderDir, fileName),
      );
    }
  }
}

syncTerraform().catch((error) => {
  process.stderr.write(
    `Failed to sync Terraform defaults: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
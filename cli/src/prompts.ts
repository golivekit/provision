import {
  select,
  search,
  input,
  password,
  confirm,
} from '@inquirer/prompts';
export { select };
import type { Provider, ProviderOption } from './types.js';

/**
 * Searchable/filterable select menu. Replaces bash choose_from_options().
 * @inquirer/prompts `search` gives built-in typeahead — no custom /search prefix needed.
 */
export async function chooseFromOptions(
  message: string,
  options: ProviderOption[],
  defaultValue?: string,
): Promise<string> {
  // Bring the default to the top so it's the first item shown
  const sorted = defaultValue
    ? [
        ...options.filter((o) => o.value === defaultValue),
        ...options.filter((o) => o.value !== defaultValue),
      ]
    : options;

  return search<string>({
    message,
    source: async (term) => {
      const lower = (term ?? '').toLowerCase();
      const filtered = lower
        ? sorted.filter((o) => o.label.toLowerCase().includes(lower) || o.value.toLowerCase().includes(lower))
        : sorted;
      return filtered.map((o) => ({ name: o.label, value: o.value }));
    },
  });
}

/** Simple text prompt. */
export async function readValue(message: string, defaultValue?: string): Promise<string> {
  return input({ message, default: defaultValue });
}

/** Hidden password/secret prompt. */
export async function readSecret(message: string, defaultValue?: string): Promise<string> {
  return password({ message, mask: '*' }).then((v) => (v === '' && defaultValue ? defaultValue : v));
}

/** Yes/no prompt. */
export async function readBool(message: string, defaultValue = true): Promise<boolean> {
  return confirm({ message, default: defaultValue });
}

/** Provider selection menu. */
export async function chooseProvider(): Promise<Provider> {
  return select<Provider>({
    message: 'Select cloud provider',
    choices: [
      { name: 'DigitalOcean', value: 'digitalocean' },
      { name: 'Hetzner Cloud', value: 'hetzner' },
      { name: 'AWS (EC2)', value: 'aws' },
    ],
  });
}

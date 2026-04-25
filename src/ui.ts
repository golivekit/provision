import pc from 'picocolors';

export function info(msg: string): void {
  process.stderr.write(pc.cyan(`  → ${msg}\n`));
}

export function success(msg: string): void {
  process.stderr.write(pc.green(`  ✓ ${msg}\n`));
}

export function warn(msg: string): void {
  process.stderr.write(pc.yellow(`  ! ${msg}\n`));
}

export function error(msg: string): never {
  process.stderr.write(pc.red(`  ✗ ${msg}\n`));
  process.exit(1);
}

export function header(msg: string): void {
  process.stderr.write(
    `\n${pc.bold(pc.white(msg))}\n${pc.dim('─'.repeat(msg.length))}\n`,
  );
}

export function logo(): void {
  const art = [
    '  ____       _     _            _  ___ _ _',
    ' / ___| ___ | |   (_)_   _____ | |/ (_) | |_ ',
    '| |  _ / _ \\| |   | \\ \ / / _ \\| \' /| | __|',
    '| |_| | (_) | |___| |\\ V /  __/| . \\| | |_ ',
    ' \\____|\\___/|_____|_| \\_/ \\___||_|\\_\\_|\\__|',
  ];

  const maxWidth = Math.max(...art.map((line) => line.length));
  const title = 'Infrastructure Provisioning';

  process.stderr.write(`\n${pc.cyan(art.join('\n'))}\n`);
  process.stderr.write(
    `${pc.bold(pc.white(title))}\n${pc.dim('─'.repeat(maxWidth))}\n`,
  );
}

export function print(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

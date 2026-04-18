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

export function print(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

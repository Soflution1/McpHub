const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;
type LogLevel = keyof typeof LEVELS;

let currentLevel: number = LEVELS.info;

export function setLogLevel(level: LogLevel) {
  currentLevel = LEVELS[level];
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function write(level: LogLevel, prefix: string, ...args: unknown[]) {
  if (LEVELS[level] < currentLevel) return;
  const msg = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');
  process.stderr.write(`[${timestamp()}] ${prefix} ${msg}\n`);
}

export const log = {
  debug: (...args: unknown[]) => write('debug', 'D', ...args),
  info:  (...args: unknown[]) => write('info',  'I', ...args),
  warn:  (...args: unknown[]) => write('warn',  'W', ...args),
  error: (...args: unknown[]) => write('error', 'E', ...args),
  server: (name: string, action: string) =>
    write('info', 'S', `[${name}] ${action}`),
  stats: (running: number, total: number, ramMb: number) =>
    write('info', 'M', `Servers: ${running}/${total} active | ~${ramMb} MB used`),
};

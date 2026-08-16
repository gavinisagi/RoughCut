/**
 * Tiny argv parser. Supports: positionals, --key value, --key=value,
 * boolean flags, and negative numbers as values (--threshold -38).
 */

export interface ParsedArgs {
  positionals: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

export function parseArgv(argv: string[], booleanFlags: Set<string>): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) {
        options.set(token.slice(2, eq), token.slice(eq + 1));
        continue;
      }
      const name = token.slice(2);
      if (booleanFlags.has(name)) {
        flags.add(name);
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`Missing value for --${name}`);
      }
      options.set(name, next);
      i++;
    } else if (token === "-o") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("Missing value for -o");
      options.set("output", next);
      i++;
    } else {
      positionals.push(token);
    }
  }
  return { positionals, options, flags };
}

export function num(options: Map<string, string>, key: string): number | undefined {
  const raw = options.get(key);
  if (raw === undefined) return undefined;
  const v = Number(raw);
  if (Number.isNaN(v)) throw new Error(`--${key} expects a number, got "${raw}"`);
  return v;
}

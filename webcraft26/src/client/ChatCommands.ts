// Minimal slash commands for the chat screen (the original `/time`, `/weather`, `/gamemode`, `/tp`, `/give`,
// `/summon`, `/kill`, `/gamerule` forms; only the argument shapes people type by hand).
//
// Time follows 26.2: `/time set` takes ticks of the day clock or the named markers day=1000, noon=6000,
// night=13000, midnight=18000 (ClockTimeMarkers / TimeCommand.java). The game itself is not touched here:
// everything goes through a small host interface so the parser can be unit tested.

export interface CommandHost {
  getTime(): number;
  setTime(ticks: number): void;
  setWeather(kind: 'clear' | 'rain' | 'thunder'): void;
  setGameMode(mode: 'survival' | 'creative'): void;
  teleport(x: number, y: number, z: number): void;
  position(): { x: number; y: number; z: number };
  give(item: string, count: number): boolean;
  summon(type: string, x: number, y: number, z: number): boolean;
  killMobs(): number;
  setDaylightCycle(on: boolean): void;
}

const TIME_NAMES: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };

/** `~`, `~5` relative coordinates as in vanilla. */
function coord(token: string | undefined, base: number): number | null {
  if (token === undefined) return null;
  if (token.startsWith('~')) {
    const rest = token.slice(1);
    if (rest === '') return base;
    const n = Number(rest);
    return Number.isFinite(n) ? base + n : null;
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** Runs one chat line. Returns the feedback message, or null when the line was not a command. */
export function runChatCommand(line: string, host: CommandHost): string | null {
  const text = line.trim();
  if (!text.startsWith('/')) return null;
  const [name, ...args] = text.slice(1).split(/\s+/);
  const bare = (s: string): string => s.replace(/^minecraft:/, '');

  switch (name) {
    case 'time': {
      const sub = args[0];
      if (sub === 'set' && args[1] !== undefined) {
        const named = TIME_NAMES[args[1]];
        const value = named ?? Number(args[1]);
        if (!Number.isFinite(value)) return `Unknown time: ${args[1]}`;
        const day = Math.floor(host.getTime() / 24000);
        host.setTime(day * 24000 + (((value % 24000) + 24000) % 24000));
        return `Set the time to ${Math.trunc(value)}`;
      }
      if (sub === 'add' && args[1] !== undefined) {
        const delta = Number(args[1]);
        if (!Number.isFinite(delta)) return `Invalid amount: ${args[1]}`;
        host.setTime(host.getTime() + delta);
        return `Set the time to ${Math.trunc(host.getTime())}`;
      }
      if (sub === 'query') return `The time is ${Math.trunc(host.getTime() % 24000)}`;
      return 'Usage: /time set <day|noon|night|midnight|ticks> | add <ticks> | query';
    }
    case 'weather': {
      const kind = args[0];
      if (kind === 'clear' || kind === 'rain' || kind === 'thunder') {
        host.setWeather(kind);
        return kind === 'clear' ? 'Set the weather to clear' : kind === 'rain' ? 'Set the weather to rain' : 'Set the weather to rain & thunder';
      }
      return 'Usage: /weather <clear|rain|thunder>';
    }
    case 'gamemode': {
      const mode = args[0];
      if (mode === 'survival' || mode === 'creative' || mode === 's' || mode === 'c' || mode === '0' || mode === '1') {
        const m = mode === 'survival' || mode === 's' || mode === '0' ? 'survival' : 'creative';
        host.setGameMode(m);
        return `Set own game mode to ${m[0].toUpperCase()}${m.slice(1)} Mode`;
      }
      return 'Usage: /gamemode <survival|creative>';
    }
    case 'tp':
    case 'teleport': {
      const p = host.position();
      const x = coord(args[0], p.x), y = coord(args[1], p.y), z = coord(args[2], p.z);
      if (x === null || y === null || z === null) return 'Usage: /tp <x> <y> <z>';
      host.teleport(x, y, z);
      return `Teleported to ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`;
    }
    case 'give': {
      // /give <item> [count]  (the selector argument is optional here: there is only one player)
      const rest = args[0] === '@s' || args[0] === '@p' ? args.slice(1) : args;
      if (!rest[0]) return 'Usage: /give <item> [count]';
      const count = rest[1] ? Math.max(1, Math.min(64, Math.trunc(Number(rest[1])) || 1)) : 1;
      return host.give(bare(rest[0]), count) ? `Gave ${count} [${bare(rest[0])}]` : `Unknown item: ${rest[0]}`;
    }
    case 'summon': {
      if (!args[0]) return 'Usage: /summon <entity> [x y z]';
      const p = host.position();
      const x = coord(args[1], p.x) ?? p.x + 3, y = coord(args[2], p.y) ?? p.y, z = coord(args[3], p.z) ?? p.z;
      return host.summon(bare(args[0]), x, y, z) ? `Summoned new ${bare(args[0])}` : `Unknown entity: ${args[0]}`;
    }
    case 'kill': {
      return `Killed ${host.killMobs()} entities`;
    }
    case 'gamerule': {
      if ((args[0] === 'advance_time' || args[0] === 'doDaylightCycle') && (args[1] === 'true' || args[1] === 'false')) {
        host.setDaylightCycle(args[1] === 'true');
        return `Gamerule ${args[0]} is now set to: ${args[1]}`;
      }
      return 'Usage: /gamerule advance_time <true|false>';
    }
    case 'help':
    case '?':
      return '/time /weather /gamemode /tp /give /summon /kill /gamerule';
    default:
      return `Unknown command: /${name}`;
  }
}

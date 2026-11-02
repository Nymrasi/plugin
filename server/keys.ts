// The user's own API keys, all optional. Two places, both on the user's own computer, never the chat:
//   1. the plugin's settings: Claude Code asks for them (userConfig in .claude-plugin/plugin.json), keeps them
//      in the system's secure credential store and hands them to this process as NYMRA_CONFIG_* (.mcp.json);
//   2. the user's own environment: NYMRA_ALCHEMY_API_KEY and the like, set in a shell profile, which Claude
//      Code passes on to the servers it starts. A value in the settings wins.
// They stay inside this process: the local relay (vendor/scanbot/src/relay.ts) adds each key to the one
// provider it belongs to, and nothing the plugin prints ever carries one (scrub). No key ships with the plugin.

export interface UserKeys {
  /** Alchemy: Base and Polygon PoS, whose explorers refuse anything but a browser. */
  alchemy?: string;
  /** Blockscout PRO API: Arbitrum One and Robinhood Chain, for the same reason. */
  pro?: string;
  /** NodeReal: BNB Smart Chain, which has no keyless source. */
  nodereal?: string;
  /** Etherscan V2: fills a gap in Polygon PoS's own index. */
  etherscan?: string;
}

export type KeyName = keyof UserKeys;

/** The variable a user sets in their own environment. */
export const KEY_ENV: Record<KeyName, string> = {
  alchemy: 'NYMRA_ALCHEMY_API_KEY',
  pro: 'NYMRA_BLOCKSCOUT_API_KEY',
  nodereal: 'NYMRA_NODEREAL_API_KEY',
  etherscan: 'NYMRA_ETHERSCAN_API_KEY',
};

/** The variable .mcp.json fills from the plugin's settings; an empty setting arrives as "". */
export const CONFIG_ENV: Record<KeyName, string> = {
  alchemy: 'NYMRA_CONFIG_ALCHEMY_API_KEY',
  pro: 'NYMRA_CONFIG_BLOCKSCOUT_API_KEY',
  nodereal: 'NYMRA_CONFIG_NODEREAL_API_KEY',
  etherscan: 'NYMRA_CONFIG_ETHERSCAN_API_KEY',
};

/** The option name in the plugin's settings (userConfig). */
export const KEY_OPTION: Record<KeyName, string> = {
  alchemy: 'alchemy_api_key',
  pro: 'blockscout_api_key',
  nodereal: 'nodereal_api_key',
  etherscan: 'etherscan_api_key',
};

/** An option left empty may arrive as "" or as its own unfilled placeholder; both mean no key. */
function value(raw: string | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v || v.includes('${')) return undefined;
  return v;
}

export function readKeys(env: Record<string, string | undefined> = process.env): UserKeys {
  const keys: UserKeys = {};
  for (const k of Object.keys(KEY_ENV) as KeyName[]) {
    const v = value(env[CONFIG_ENV[k]]) ?? value(env[KEY_ENV[k]]);
    if (v) keys[k] = v;
  }
  return keys;
}

/** Every key value out of a text, the last guard before anything leaves this process. */
export function scrub(text: string, keys: UserKeys): string {
  let out = text;
  for (const v of Object.values(keys)) {
    if (v && v.length >= 4) out = out.split(v).join('[key]');
  }
  return out;
}

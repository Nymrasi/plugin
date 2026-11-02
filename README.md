# Nymra Privacy Scan for Claude

Ask Claude how traceable a wallet is. Give it any EVM wallet or ENS name and the Nymra Privacy Score comes back: a number from 0 (exposed) to 100 (private), every finding that costs points with the evidence behind it, the wallets it is likely linked to, and a fix plan with what you can change today. The scan runs on your own computer with the open [privacy-scan](https://github.com/nymrasi/privacy-scan) engine, the same engine behind [nymra.si](https://nymra.si).

> The scan runs on your computer and Nymra receives nothing. What you type in the chat, the wallet included, reaches your AI provider like any other message.

## What it adds to Claude

- **`scan_wallet`**: the Privacy Score of a wallet, every finding with its evidence (transactions and addresses, with explorer links), the linked wallets with their confidence, and which chains were read.
- **`fix_plan`**: what the owner can undo today and how many points that wins back, what to do differently from now on, and what is on chain for good, with who can see each leak and the steps to take.
- **The `wallet-privacy` skill**: tells Claude when to use the two tools and how to word a result, so a link between wallets always stays a likelihood with a confidence.
- **The `/nymra-privacy-scan:scan` command**: `/nymra-privacy-scan:scan vitalik.eth` scans a wallet and gives its fix plan in one go.

Both tools only read. They never ask for a seed phrase, a private key, a signature or a login, and they refuse one that is pasted in.

## Use it

Ask in your own words:

- "How private is vitalik.eth?"
- "What links 0x... to an exchange?"
- "Give me the fix plan for my wallet 0x..."

A scan takes about 20 seconds to 2 minutes, depending on how many chains the wallet used.

## Where it works

The scan is a local MCP server, a small program Claude starts on your computer. It runs in **Claude Code** (the terminal, the IDE extensions and the Code tab of the desktop app) and in **Cowork** when the session runs on your computer. Chat on claude.ai, in the desktop app's chat and in the mobile apps starts no program on your computer, so there the skill loads but the scan does not.

It needs **Node.js 22.18 or newer** on your computer (`node --version`). There is nothing to install besides the plugin: it ships its own code and has no dependencies.

## Install

In Claude Code:

```
/plugin marketplace add nymrasi/claude-plugin
/plugin install nymra-privacy-scan@nymra
```

Claude Code then asks for the optional keys below; leave them empty to start.

## Your own keys (optional)

Most chains are read without a key. A few explorers answer a browser only, and one chain has no source without a key, so a wallet active there gets no score until those chains are read. A key of your own reads them, and the scan tells you which one it needs:

| Key | Reads | Get it | Goes to |
|---|---|---|---|
| Alchemy | Base, Polygon PoS | [dashboard.alchemy.com/signup](https://dashboard.alchemy.com/signup): create an app, copy its API key | Alchemy only (`*.g.alchemy.com`) |
| Blockscout | Arbitrum One, Robinhood Chain | [dev.blockscout.com](https://dev.blockscout.com): create an API key | Blockscout only (`api.blockscout.com`) |
| NodeReal | BNB Smart Chain | [nodereal.io/meganode](https://nodereal.io/meganode): copy the API key it gives you | NodeReal only (`bsc-mainnet.nodereal.io`) |
| Etherscan | a gap in Polygon PoS's own index | [etherscan.io/myapikey](https://etherscan.io/myapikey): add an API key | Etherscan only (`api.etherscan.io`) |

Each provider gives a key on its starter plan when you sign up. Put the key in one of two places, both on your own computer:

- **The plugin's settings** (recommended): in Claude Code, run `/plugin configure nymra-privacy-scan@nymra`, or answer the questions Claude Code asks when you install the plugin. Claude Code keeps the keys in your system's secure credential store.
- **Your own environment**: set `NYMRA_ALCHEMY_API_KEY`, `NYMRA_BLOCKSCOUT_API_KEY`, `NYMRA_NODEREAL_API_KEY` or `NYMRA_ETHERSCAN_API_KEY` in your shell profile and restart Claude Code. A key in the settings wins.

Then run `/reload-plugins` and scan again. **Never paste a key into the chat:** everything typed there reaches your AI provider. If one is pasted in, the plugin refuses it and does not repeat it; make a new key at the provider and delete that one.

A key never appears in an answer, a log or an error, the scan sends it only to its own provider, and no key ships with the plugin.

## Privacy and data

- **What runs:** `node server/main.ts` from this plugin, started by Claude Code over stdio. Everything it runs is in this repository as readable source: `server/` is the plugin, `vendor/` the engine and the parts of Nymra's bot that run it outside a browser (see `vendor/SOURCE.json` for the exact commits).
- **What it sends, and where:** the wallet address, to public block explorers and nodes, the same requests your browser makes when you open the wallet on an explorer. These are the hosts it can reach:
  - Explorers: `eth.blockscout.com`, `base.blockscout.com`, `arbitrum.blockscout.com`, `explorer.optimism.io`, `polygon.blockscout.com`, `robinhoodchain.blockscout.com`, `zksync.blockscout.com`, `scrollscan.com`, `unichain.blockscout.com`, `gnosisscan.io`, `explorer.inkonchain.com`, `soneium.blockscout.com`, `celo.blockscout.com`, `api.routescan.io`
  - Nodes: `ethereum-rpc.publicnode.com`, `eth.drpc.org`, `base-rpc.publicnode.com`, `arbitrum-one-rpc.publicnode.com`, `optimism-rpc.publicnode.com`, `polygon-bor-rpc.publicnode.com`, `rpc.mainnet.chain.robinhood.com`, `avalanche-c-chain-rpc.publicnode.com`, `mainnet.era.zksync.io`, `scroll-rpc.publicnode.com`, `unichain-rpc.publicnode.com`, `gnosis-rpc.publicnode.com`, `rpc-gel.inkonchain.com`, `soneium-rpc.publicnode.com`, `bsc-rpc.publicnode.com`, `celo-rpc.publicnode.com`
  - ENS names: `bens.services.blockscout.com`
  - Only with a key of your own: `base-mainnet.g.alchemy.com`, `polygon-mainnet.g.alchemy.com`, `api.blockscout.com`, `bsc-mainnet.nodereal.io`, `api.etherscan.io`
- **What Nymra receives:** nothing. The plugin never contacts a Nymra server, sends no telemetry and writes no log line and no file. The exchange and service label lists ship with the engine, so a label lookup stays on your computer.
- **What stays in memory:** the last results, for ten minutes, so a fix plan right after a scan needs no second scan. They are gone when Claude Code stops the scan.
- **What your AI provider sees:** what you type and what the tools answer is part of your conversation with Claude, and reaches Anthropic like any other message. Claude Code also keeps your conversations on your computer, as it does with every chat.

## How the score works

Every wallet starts at 100. Each finding costs points by its severity and the engine's confidence, each kind of finding has a cap, and a wallet with a public label scores 34 or less. The rules, their thresholds and the formula are open: see [RULES.md](https://github.com/nymrasi/privacy-scan/blob/main/RULES.md) and [nymra.si/docs](https://nymra.si/docs/).

A link between wallets is always a likelihood with a confidence (Likely, Possible or Weak). The scan never says who owns a wallet.

## Limits

- EVM chains only: an address that is not `0x` with 40 hex characters is refused.
- A chain that could not be read counts as not read, never as a chain without activity. A wallet with such a gap gets no score until it is read, and the answer says which chains are missing.
- On a long history the newest transactions and the oldest ones are read, and what lies between is not.
- Public data only. Whoever holds private records, such as an exchange that knows its customers, can link more than this scan shows.

## Develop

```sh
npm test                      # node --test, no network
node scripts/mutate.mjs       # breaks one rule at a time; every mutant must be caught
node scripts/ask.mjs scan_wallet vitalik.eth   # ask the server the way Claude does
node scripts/sync.mjs         # take the bot repo's latest scanner and engine
```

## License

MIT, see [LICENSE](LICENSE). The engine is MIT too, and `vendor/noble-hashes/` is [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.4.0, MIT.

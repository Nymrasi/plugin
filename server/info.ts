// Who the server is, for the initialize answer.
export const VERSION = '0.1.0';

export const INSTRUCTIONS =
  'Nymra Privacy Scan: how traceable an EVM wallet is, from its public history. Use scan_wallet for the Privacy Score with every finding and its evidence, and fix_plan for what to change. Both read only and run on this computer. Pass on the score, the costliest findings and the wording of each link as given: a link between wallets is a likelihood with a confidence, never proof of who owns a wallet. Never ask for a seed phrase, a private key or a signature; the scan needs only the address or the ENS name.';

/** The same, for Nymra's online server: it scans with its own keys and sees the address, keeping nothing. */
export const INSTRUCTIONS_HOSTED =
  "Nymra Privacy Scan: how traceable an EVM wallet is, from its public history. When the user names a wallet, a 0x address or a name such as vitalik.eth, call scan_wallet at once with it as written; do not ask them to confirm it first. One call gives the Privacy Score, every finding with its evidence, and the fix plan. It only reads, and it runs on Nymra's server, which sees the address it scans and keeps nothing. Pass on the score, the costliest findings and the wording of each link as given: a link between wallets is a likelihood with a confidence, never proof of who owns a wallet. Never ask for a seed phrase, a private key, an API key or a signature; the scan needs only the address or the ENS name.";

# Contributing

Conventions for working in this repo, a short architecture primer, and the
checklist of credentials a new contributor needs. If you're setting up the
repo for the first time, start with [`README.md`](./README.md) instead —
come back here once you're running.

## Conventions

### Commit messages

The convention already in use throughout the history:

```
<type>(<Scope>) - #<issue-number> - <description>
```

- `type`: `feat`, `fix`, `refactor`, `infra`, etc. — same vocabulary as
  Conventional Commits, lowercase
- `Scope`: PascalCase, names the feature/domain area (`Credibility`,
  `Parity`, `Auth`, `Blockchain`, `SharedTypePackage`, `Git`) — roughly maps
  to a `src/features/*` folder or a cross-cutting concern
- `#<issue-number>`: the GitHub issue this closes/relates to. Omit it for
  commits with no tracked issue (small housekeeping, comment fixes)

Examples from the log:

```
feat(Parity) - #806 - add RoleChange event to blockchainEvent scanner
fix(Credibility) - #786 - add blockchianSyncQueue and recordHashHistory write to credibility preparation service when a hash is being added
infra(Git) - #800 - git ignore deterministic build files and stop tracking them
```

### Web3 concepts used in this repo

- **Account Abstraction / gasless transactions** — users don't need ETH to
  pay gas. `BelrosePaymaster.sol`, together with Pimlico's bundler
  infrastructure, sponsors transactions so an on-chain action (registering,
  anchoring a record hash) just happens from the user's point of view. (see [`Paymaster.md`](./contracts/Paymaster.md))
- **Why hashes, not records, go on-chain** — raw records stay end-to-end
  encrypted and never leave the client in plaintext (see
  [`Encryption.md`](./Encryption.md)). Only hashes are written on chain, NEVER ciphertext and obviously never plaintext health records. CipherText on chain would be there forever and would be susceptible to harvest now decrypt later attacks. With cipherText in our database, it's protected and if an encryption algorithm is ever cracked we could rotate the encryption, deny access etc. Putting CipherText on chain would be doing half of an attacker's job for them.
- **UUPS upgradeable proxies** — `HealthRecordCore.sol` and
  `MemberRoleManager.sol` sit behind proxies. The proxy address is
  permanent and is what everything else calls; the logic behind it can be
  swapped via an upgrade transaction. This is why a fresh deploy is
  forbidden — it would produce a new address and break every existing
  reference.

For more depth: [`Encryption.md`](./Encryption.md) (key hierarchy, threat
model), [`Credibility.md`](./Credibility.md) (verification/dispute/vouch
system), [`contracts/`](./contracts/) (per-contract reference docs), and
[`../src/features/Permissions/ARCHITECTURE.md`](../src/features/Permissions/ARCHITECTURE.md)
(permissions data-model rationale).

## Credentials checklist

Everything below is requested from Dennis. None of it ever goes in a file
that's committed to git — copy `.env.example` (root, `functions/`,
`contracts/`) to the real `.env`/`.env.local` files and fill them in
locally; see [`README.md`](./README.md#first-time-setup).

| What                                                     | Used for                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo access                                       | Push/PR access                                                                                                                                                    |
| Firebase project console access                          | View Firestore/Auth/Storage/Functions, project settings                                                                                                           |
| `VITE_FIREBASE_*` config values                          | Frontend Firebase SDK init, goes in `.env.local`                                                                                                                  |
| Firebase Secret Manager access                           | Set/rotate Cloud Functions secrets (`firebase functions:secrets:set <NAME>`) — only needed when deploying functions that touch AI/email/Stripe/paymaster          |
| Anthropic API key                                        | Claude-powered AI features (FHIR record conversion, computer vision, AI chat)                                                                                     |
| OpenAI API key                                           | Secondary provider in the `aiChat` handler                                                                                                                        |
| — (no separate key needed)                               | Gemini access goes through the Firebase project's own GCP service identity (Vertex AI metadata server), not an API key — covered by Firebase project access above |
| Pimlico API key                                          | Account Abstraction bundler/paymaster                                                                                                                             |
| Alchemy API key                                          | RPC provider for Base Sepolia                                                                                                                                     |
| Resend API key                                           | Transactional email (invites, notifications)                                                                                                                      |
| Stripe test keys (publishable + secret + webhook secret) | Payments / identity verification                                                                                                                                  |
| IDswyft keys                                             | Identity verification (currently unused in prod — see the comment in `.env.example`)                                                                              |
| Sentry DSN                                               | Error monitoring                                                                                                                                                  |
| Etherscan/Basescan API key                               | Contract verification after an upgrade                                                                                                                            |
| Base Sepolia testnet wallet + faucet funds               | Local contract interaction                                                                                                                                        |
| Admin/deployer wallet private key                        | Signs on-chain admin actions and contract upgrades — higher stakes than the rest, see custody note below                                                          |

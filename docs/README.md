# Belrose Health - Personal Sovereignty Protocol

A technology and incentivization infrastructure that gives people sovereignty over their health data

## The Problem

Health records do not truly exist. Records are siloed across multiple providers, devices, and countries.

- This results in the people not having basic health information about themselves
- Without comprehensive records, we will never unlock the potential of technology in healthcare

## Our Solution

- **Collect Records**: Build systems to allow patients to utilize their GDPR/HIPAA rights to compel medical professionals to provide them their health records
- **Standardize, Interoperable Records**: Transform those records into standardize FHIR format so data can work across healthcare systems.
- **Client-Side Encryption**: Records are encrypted with a user's encryption key before uploading. Therefore only the patient has access.
- **Share At Will**: Build granular permission controls to give users complete control over who they share their records with.
- **Blockchain Verification**: Health data is hashed and stored on the blockchain along with verifications and disputes from third-parties.

This all enables the ultimate goal:

- **Sovereignty**: Allow patients sovereignty over their data and the ability to capture the economics and value that comes from it.

## Tech Stack

- React + Vite (frontend)
- End-to-End encryption (E2EE)
  - AES for encrypting records, messages, and AI Chats
  - RSA for passing encrypted keys
- Blockchain (Solidity) for data verification
- Pimlico - Account Abstraction for gasless blockchain transactions
- Firebase (backend database, authentication, and file storage)

## Project Status

This is a research and MVP development project.

## Getting Started

### Prerequisites

- Node 22 (see `functions/package.json` `engines`)
- npm
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- Git

### Repo layout

Belrose Health uses a monorepo structure

| Path               | What it is                                              |
| ------------------ | ------------------------------------------------------- |
| `/src`             | React 19 frontend (Vite)                                |
| `/functions`       | Firebase Cloud Functions (Node 22, TypeScript)          |
| `/packages/shared` | Shared types/utils, used by both frontend and functions |
| `/contracts`       | Solidity smart contracts (Hardhat)                      |
| `/docs`            | Project documentation (this folder)                     |

Only `/packages/*` is an actual [npm workspace](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
(see the root `package.json`'s `workspaces` field) — that's what lets
`/packages/shared` be imported directly by both the frontend and
`/functions` without being published anywhere. `/functions` and
`/contracts` are ordinary, separate npm projects that just happen to live
in the same repo, each with its own `package.json`/`node_modules` — which
is why step 1 below has three separate `npm install` calls instead of one.

See [`CLAUDE.md`](../CLAUDE.md) at the repo root for the full tech stack, key
commands, and architecture conventions — it's written for Claude Code but
works just as well as a human reference.

### First-time setup

1. Clone the repo and install dependencies in each workspace:

   ```bash
   npm install
   cd functions && npm install && cd ..
   cd contracts && npm install && cd ..
   ```

2. Get your `.env` files. Copy the three example files and fill them in —
   see [`CONTRIBUTING.md` § Credentials checklist](./CONTRIBUTING.md#credentials-checklist)
   for what each variable is and how to request access:

   ```bash
   cp .env.example .env.local
   cp functions/.env.example functions/.env
   cp contracts/.env.example contracts/.env
   ```

3. Sync the shared package into `/contracts` (`/functions` does this
   automatically as part of its build):

   ```bash
   cd contracts && npm run copy-shared && cd ..
   ```

4. Start the Firebase emulators (Auth, Firestore, Functions, Storage — see
   the port table in `CLAUDE.md`):

   ```bash
   firebase emulators:start
   ```

5. In another terminal, start the frontend:

   ```bash
   npm run dev
   ```

### Running tests

`CLAUDE.md`'s Testing section documents all six layers (frontend unit →
rules → orchestration → functions → contracts → e2e) and when to reach for
each. The fast local loop is `npm run test` (Vitest, no emulator needed) and
`npm run type-check`.

### Where to go next

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — commit/branch conventions,
  architecture primer, and the full credentials checklist
- [`Encryption.md`](./Encryption.md), [`Credibility.md`](./Credibility.md),
  [`contracts/`](./contracts/) — deep dives on the E2EE design, the
  credibility system, and each smart contract

## Author

Dennis Tran  
London, United Kingdom  
dennis@belrosehealth.com

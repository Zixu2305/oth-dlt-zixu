# Hedera Testnet Contract Deployer

Deploys a **compiled** smart contract (solc / Hardhat / Foundry bytecode) to the
**Hedera Testnet** using the official [`@hashgraph/sdk`](https://www.npmjs.com/package/@hashgraph/sdk).

It uses `ContractCreateFlow`, which automatically uploads the bytecode to a
Hedera file (chunked for large contracts) and creates the contract in one step —
so you don't need separate `FileCreateTransaction` / `FileAppendTransaction`
calls.

## VoteTopic course-test implementation

This repository contains a voting contract and a small local interface created
for the course test:

- `contracts/voteTopic.sol` contains the `VoteTopic` Solidity contract.
- `deployVoteTopic.js` configures and deploys that contract to Hedera Testnet.
- `site/` contains a local browser interface for displaying proposals, casting
  votes with temporary Testnet credentials, and demonstrating the safeguards.

### Contract behaviour

Proposal names and blocked voter addresses are supplied to the constructor and
cannot be changed after deployment. The contract:

- requires between 1 and 50 proposals;
- accepts readable proposal names of up to 31 UTF-8 bytes;
- allows every address not in the fixed blocklist to vote once;
- records voter state as `Eligible`, `Blocked`, or `Voted`;
- rejects blocked voters, repeat votes, and invalid proposal indices;
- exposes proposal names and vote counts through indexed getter functions;
- emits a `VoteCast` event after every successful vote; and
- returns the proposal with the most votes through `winner()`.

If multiple proposals are tied, the proposal appearing first in the constructor
input is returned. Calling `winner()` before a vote has been cast reverts.

The design enforces one vote per blockchain address, not one vote per human. A
person who controls multiple accounts could vote once from each account.

### Efficiency choices

- Names remain human-readable `string` values, but the 31-byte limit lets
  Solidity use its single-slot short-string storage representation.
- The voter mapping provides constant-time eligibility and repeat-vote checks.
- Proposal data is retrieved one proposal at a time instead of returning an
  unbounded dynamic array.
- `winner()` performs a linear scan, but `MAX_PROPOSALS` bounds it to at most 50
  iterations.
- The contract contains no administrator state or external contract calls.
- The deployment build uses the Solidity optimizer with 200 runs.

The blocklist constructor loop is only used during deployment. For a larger or
untrusted deployment configuration, a separate maximum blocklist length could
also be added to place an explicit bound on constructor work.

### Compile and deploy VoteTopic

Compile the exact source that will be deployed:

```bash
solc --optimize --optimize-runs 200 \
  --bin --abi contracts/voteTopic.sol \
  -o build --overwrite
```

Set the proposals and blocked EVM addresses in the `CONFIG` object in
`deployVoteTopic.js`. For ECDSA accounts, use the public-key-derived `0x...` EVM
address that the contract will receive as `msg.sender`.

Validate the configuration without submitting a transaction:

```bash
node deployVoteTopic.js --dry-run
```

Deploy to Hedera Testnet:

```bash
node deployVoteTopic.js
```

The script prints the new contract ID, EVM address, and HashScan link. A deployed
contract is not updated when the local Solidity file changes; contract changes
require compilation and a new deployment.

### Local demonstration site

Start the interface with:

```bash
npm run site:dev
```

Then open the local URL printed by Vite and:

1. Load the deployed contract using its `0.0.x` ID or EVM address.
2. Enter an ECDSA Hedera Testnet account ID and its matching Testnet private key.
3. Start the temporary session and check the displayed voter state.
4. Cast a vote, then try again to demonstrate the one-vote restriction.
5. Repeat with the account whose EVM address was placed in the deployment
   blocklist to demonstrate the blocked-voter rejection.
6. Select **Forget account** when the test is complete.

The site checks the public Testnet account record to ensure the account ID and
key-derived EVM address match. The private key is kept only in memory for the
current browser tab, the input is cleared after use, and the credential is not
written to browser storage. This credential-entry interface is strictly for a
local Testnet experiment and must not be hosted publicly or used with Mainnet
credentials.

## 1. Setup

```bash
npm install
cp .env.example .env      # then fill in your Testnet operator ID + key
```

Get free Testnet credentials at the [Hedera Portal](https://portal.hedera.com/).

## 2. Deploy

Point the script at either a compiler **artifact JSON** or a raw **`.bin`** file:

```bash
# Hardhat / Foundry / solc artifact JSON
node deploy.js ./artifacts/MyContract.json

# raw bytecode file
node deploy.js ./build/MyContract.bin --gas 300000
```

### Constructor arguments

Pass typed arguments in the order the constructor expects them:

```bash
node deploy.js ./artifacts/MyToken.json \
  --arg-string  "MyToken" \
  --arg-string  "MTK" \
  --arg-uint256 1000000
```

Supported flags: `--arg-string`, `--arg-address` (accepts `0.0.x` or `0x…`),
`--arg-uint256`, `--arg-bool`. Extend `parseArgs`/`buildConstructorParams` in
`deploy.js` for further Solidity types.

### Options

| Flag     | Default  | Description                          |
|----------|----------|--------------------------------------|
| `--gas`  | `200000` | Gas limit for contract creation      |
| `--memo` | *(none)* | Optional contract memo               |

## 3. Call a method (`call.js`)

`call.js` is a **template** for invoking a method on an already-deployed
contract. Open the file and fill in the `CONFIG` block:

- `CONTRACT_ID` – the contract to call
- `MODE` – `"query"` for view/pure functions (free), `"execute"` for
  state-changing ones (costs gas, returns a receipt status)
- `METHOD_NAME` – the Solidity function name
- `buildParams()` – add the call arguments in order
- `RETURN_TYPE` – the single return type to decode (**multiple return values
  are not supported**); set to `null` if the method returns nothing

Then run:

```bash
node call.js
```

It prints the decoded return value, its type, and the call status:

```
Result
  Return value : Hello Hedera
  Return type  : string
  Call status  : SUCCESS
```

Supported return types: `string`, `bool`, `address`, `uint256`, `int256`,
`uint64`, `int64`, `uint32`, `int32`, `bytes`, `bytes32`.

## 4. Deploy output

On success you get the Hedera Contract ID, the EVM address, and a HashScan link:

```
✅ Contract deployed successfully
  Contract ID : 0.0.1234567
  EVM address : 0x0000000000000000000000000000000000012d687
  HashScan    : https://hashscan.io/testnet/contract/0.0.1234567
```

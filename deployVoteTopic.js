/**
 * Deploy a compiled smart contract to the Hedera Testnet.
 *
 * Usage:
 *   node deploy.js <artifact-or-bin-file> [--gas 200000] [--memo "..."] [ABI-encoded constructor args...]
 *
 * Examples:
 *   node deploy.js ./artifacts/MyContract.json
 *   node deploy.js ./build/MyContract.bin --gas 300000
 *   node deploy.js ./artifacts/MyToken.json --arg-string "MyToken" --arg-string "MTK" --arg-uint256 1000000
 *
 * Requires a .env file (see .env.example) with:
 *   HEDERA_OPERATOR_ID   e.g. 0.0.12345
 *   HEDERA_OPERATOR_KEY  ECDSA or ED25519 private key (hex or DER)
 */

import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import {
  Client,
  PrivateKey,
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  Hbar,
} from "@hashgraph/sdk";

const CONFIG = {
  BYTECODE_PATH: "./build/VoteTopic.bin",
  GAS: 800_000,
  MEMO: "VoteTopic course test",

  PROPOSAL_NAMES: [
    "Artificial Intelligence",
    "Blockchain",
    "Cybersecurity",
  ],

  BLOCKED_ACCOUNT_IDS: [
    // Example:
    // "0.0.123456",
    "0xb9cafcdaa17cff51f17b98a70c27fa6e9a4b8cc2",
  ],
};

/* ------------------------------------------------------------------ */
/* 1. Read the compiled bytecode                                       */
/* ------------------------------------------------------------------ */

/**
 * Accepts either:
 *   - a raw .bin file containing the hex bytecode, or
 *   - a compiler artifact JSON (Hardhat / Foundry / solc) that carries the
 *     bytecode under one of the common field names.
 */
function loadBytecode(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();

  // Raw .bin / .hex file: just the bytecode string.
  if (filePath.endsWith(".bin") || filePath.endsWith(".hex")) {
    return normalizeHex(raw);
  }

  // JSON artifact from solc / Hardhat / Foundry.
  const artifact = JSON.parse(raw);

  const candidate =
    artifact.bytecode ??                       // solc / Hardhat
    artifact.bytecode?.object ??               // some solc variants
    artifact.deployedBytecode?.object ??
    artifact.data?.bytecode?.object ??         // solc standard-json output
    artifact.evm?.bytecode?.object;            // solc contract output

  if (!candidate) {
    throw new Error(
      `Could not find a bytecode field in ${filePath}. ` +
        `Expected one of: bytecode, bytecode.object, evm.bytecode.object.`
    );
  }
  return normalizeHex(typeof candidate === "string" ? candidate : candidate.object);
}

function normalizeHex(hex) {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) {
    throw new Error("Bytecode is empty.");
  }
  if (!/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error("Bytecode is not valid hex.");
  }
  return stripped;
}

/* ------------------------------------------------------------------ */
/* 2. Validate and encode the VoteTopic constructor                    */
/* ------------------------------------------------------------------ */

function validateConfig() {
  if (CONFIG.PROPOSAL_NAMES.length === 0) {
    throw new Error("At least one proposal is required.");
  }

  if (CONFIG.PROPOSAL_NAMES.length > 50) {
    throw new Error("No more than 50 proposals are allowed.");
  }

  for (const proposalName of CONFIG.PROPOSAL_NAMES) {
    const byteLength = Buffer.byteLength(proposalName, "utf8");

    if (byteLength === 0) {
      throw new Error("Proposal names cannot be empty.");
    }

    if (byteLength > 31) {
      throw new Error(
        `Proposal "${proposalName}" exceeds the 31-byte limit.`
      );
    }
  }

  if (!Number.isInteger(CONFIG.GAS) || CONFIG.GAS <= 0) {
    throw new Error("GAS must be a positive integer.");
  }
}

/** Convert a Hedera 0.0.x ID or EVM address to a Solidity address. */
function toEvmAddress(value) {
  if (value.startsWith("0x")) {
    return value;
  }

  return AccountId.fromString(value).toSolidityAddress();
}

function buildConstructorParams() {
  const blockedAddresses =
    CONFIG.BLOCKED_ACCOUNT_IDS.map(toEvmAddress);

  return new ContractFunctionParameters()
    .addStringArray(CONFIG.PROPOSAL_NAMES)
    .addAddressArray(blockedAddresses);
}

/* ------------------------------------------------------------------ */
/* 3. Build the Hedera client for Testnet                              */
/* ------------------------------------------------------------------ */

/** Parse a private key that may be DER-encoded or a raw ECDSA/ED25519 hex string. */
function parsePrivateKey(raw) {
  try {
    return PrivateKey.fromStringDer(raw);
  } catch {
    // Fall back to raw ECDSA hex (Hedera Portal "HEX Encoded Private Key").
    return PrivateKey.fromStringECDSA(raw);
  }
}

function makeTestnetClient() {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;

  if (!operatorId || !operatorKeyRaw) {
    throw new Error(
      "Please set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in your environment (.env)."
    );
  }

  // Works for both ECDSA and ED25519 keys, DER- or hex-encoded.
  const operatorKey = parsePrivateKey(operatorKeyRaw);

  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), operatorKey);
  // Cap accidental fee spend; adjust as needed.
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return client;
}

/* ------------------------------------------------------------------ */
/* 4. Deploy                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  validateConfig();

  const bytecodePath = path.resolve(CONFIG.BYTECODE_PATH);
  const bytecode = loadBytecode(bytecodePath);
  const constructorParams = buildConstructorParams();

  console.log(
    `Preparing ${path.basename(bytecodePath)} for Hedera Testnet ...`
  );
  console.log(`  gas:              ${CONFIG.GAS}`);
  console.log(`  proposals:        ${CONFIG.PROPOSAL_NAMES.length}`);
  console.log(`  blocked accounts: ${CONFIG.BLOCKED_ACCOUNT_IDS.length}`);
  console.log(`  bytecode size:    ${bytecode.length / 2} bytes`);

  if (process.argv.includes("--dry-run")) {
    console.log("\nDry run successful: configuration and encoding are valid.");
    return;
  }

  const client = makeTestnetClient();

  try {
    const flow = new ContractCreateFlow()
      .setGas(CONFIG.GAS)
      .setBytecode(bytecode)
      .setConstructorParameters(constructorParams);

    if (CONFIG.MEMO) {
      flow.setContractMemo(CONFIG.MEMO);
    }

    console.log("\nSubmitting deployment transaction ...");

    const txResponse = await flow.execute(client);
    const receipt = await txResponse.getReceipt(client);

    const contractId = receipt.contractId;

    if (!contractId) {
      throw new Error(
        `Deployment failed with status: ${receipt.status.toString()}`
      );
    }

    const evmAddress = contractId.toSolidityAddress();

    console.log("\nContract deployed successfully");
    console.log(`  Contract ID : ${contractId.toString()}`);
    console.log(`  EVM address : 0x${evmAddress}`);
    console.log(
      `  HashScan    : https://hashscan.io/testnet/contract/${contractId}`
    );
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Deployment error:", err.message ?? err);
  process.exit(1);
});

/**
 * Print every proposal total from a deployed VoteTopic contract.
 *
 * Usage:
 *   node resultsVoteTopic.js --contract 0.0.123456
 *
 * CONTRACT_ID from .env is used when --contract is omitted.
 */

import "dotenv/config";
import {
  AccountId,
  Client,
  ContractCallQuery,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  PrivateKey,
} from "@hashgraph/sdk";

const QUERY_GAS = 100_000;

function parsePrivateKey(raw) {
  try {
    return PrivateKey.fromStringDer(raw);
  } catch {
    try {
      return PrivateKey.fromStringECDSA(raw);
    } catch {
      return PrivateKey.fromStringED25519(raw);
    }
  }
}

function parseContractId(argv) {
  let contractId = process.env.CONTRACT_ID;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--contract") {
      contractId = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  if (!contractId || !/^0\.0\.\d+$/.test(contractId)) {
    throw new Error(
      "Set CONTRACT_ID in .env or pass --contract with a Hedera 0.0.x contract ID.",
    );
  }

  return contractId;
}

function makeTestnetClient() {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;

  if (!operatorId || !operatorKey) {
    throw new Error(
      "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env before reading results.",
    );
  }

  const client = Client.forTestnet();
  client.setOperator(
    AccountId.fromString(operatorId),
    parsePrivateKey(operatorKey),
  );
  client.setDefaultMaxTransactionFee(new Hbar(5));
  return client;
}

async function query(client, contractId, method, params) {
  return new ContractCallQuery()
    .setContractId(contractId)
    .setGas(QUERY_GAS)
    .setFunction(method, params ?? new ContractFunctionParameters())
    .execute(client);
}

async function readProposals(client, contractId) {
  const countResult = await query(client, contractId, "getProposalCount");
  const count = countResult.getUint256(0).toNumber();
  const proposals = [];

  for (let index = 0; index < count; index++) {
    const result = await query(
      client,
      contractId,
      "getProposal",
      new ContractFunctionParameters().addUint256(index),
    );

    proposals.push({
      index,
      name: result.getString(0),
      voteCount: BigInt(result.getUint256(1).toString()),
    });
  }

  return proposals;
}

function describeResult(proposals) {
  const highestVoteCount = proposals.reduce(
    (highest, proposal) =>
      proposal.voteCount > highest ? proposal.voteCount : highest,
    0n,
  );

  if (highestVoteCount === 0n) {
    return "No votes have been cast.";
  }

  const leaders = proposals.filter(
    (proposal) => proposal.voteCount === highestVoteCount,
  );

  if (leaders.length > 1) {
    return `Draw: ${leaders.map((proposal) => proposal.name).join(", ")} (${highestVoteCount} each)`;
  }

  return `Winner: ${leaders[0].name} (${highestVoteCount})`;
}

async function main() {
  const contractIdString = parseContractId(process.argv);
  const contractId = ContractId.fromString(contractIdString);
  const client = makeTestnetClient();

  try {
    const proposals = await readProposals(client, contractId);
    const totalVotes = proposals.reduce(
      (total, proposal) => total + proposal.voteCount,
      0n,
    );

    console.log(`VoteTopic results — ${contractIdString}\n`);
    for (const proposal of proposals) {
      console.log(
        `  [${proposal.index}] ${proposal.name}: ${proposal.voteCount} vote${proposal.voteCount === 1n ? "" : "s"}`,
      );
    }

    console.log(`\nTotal votes: ${totalVotes}`);
    console.log(describeResult(proposals));
    console.log(
      `HashScan: https://hashscan.io/testnet/contract/${contractIdString}`,
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(`\nResults error: ${error.message ?? error}`);
  process.exitCode = 1;
});

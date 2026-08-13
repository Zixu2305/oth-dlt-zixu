import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress,
} from "ethers";
import { DEFAULT_CONTRACT_ADDRESS, HEDERA_TESTNET } from "./config.js";
import "./styles.css";

const CONTRACT_ABI = [
  "function getProposalCount() view returns (uint256)",
  "function getProposal(uint256 proposalIndex) view returns (string name, uint256 voteCount)",
  "function voters(address) view returns (uint8)",
  "function vote(uint256 proposalIndex)",
  "function winner() view returns (string result)",
];

const VOTER_STATES = ["Eligible", "Blocked", "Voted"];
const readProvider = new JsonRpcProvider(HEDERA_TESTNET.rpcUrl);

const elements = {
  openSession: document.querySelector("#openSession"),
  credentialForm: document.querySelector("#credentialForm"),
  voterAccountId: document.querySelector("#voterAccountId"),
  voterPrivateKey: document.querySelector("#voterPrivateKey"),
  sessionDetails: document.querySelector("#sessionDetails"),
  activeAccountId: document.querySelector("#activeAccountId"),
  forgetAccount: document.querySelector("#forgetAccount"),
  contractForm: document.querySelector("#contractForm"),
  contractAddress: document.querySelector("#contractAddress"),
  proposalGrid: document.querySelector("#proposalGrid"),
  voterState: document.querySelector("#voterState"),
  stateDot: document.querySelector("#stateDot"),
  accountAddress: document.querySelector("#accountAddress"),
  copyAddress: document.querySelector("#copyAddress"),
  winnerName: document.querySelector("#winnerName"),
  refreshData: document.querySelector("#refreshData"),
  statusMessage: document.querySelector("#statusMessage"),
};

let signingWallet;
let connectedAccountId = "";
let connectedAddress = "";
let contractAddress = "";
let voterState = "Not connected";
let transactionPending = false;

function normalizeContractAddress(value) {
  const candidate = value.trim();

  if (isAddress(candidate)) {
    return getAddress(candidate);
  }

  const contractIdMatch = candidate.match(/^0\.0\.(\d+)$/);
  if (contractIdMatch) {
    const hex = BigInt(contractIdMatch[1]).toString(16).padStart(40, "0");
    return getAddress(`0x${hex}`);
  }

  throw new Error("Enter a valid 0.0.x contract ID or 0x EVM address.");
}

function parseEcdsaPrivateKey(value) {
  const candidate = value.trim().replace(/^0x/, "");

  if (!/^[0-9a-fA-F]+$/.test(candidate)) {
    throw new Error("The private key must be a hexadecimal ECDSA key.");
  }

  if (candidate.length === 64) {
    return `0x${candidate}`;
  }

  const hederaEcdsaDerPrefix = "3030020100300706052b8104000a04220420";
  if (
    candidate.length === hederaEcdsaDerPrefix.length + 64 &&
    candidate.toLowerCase().startsWith(hederaEcdsaDerPrefix)
  ) {
    return `0x${candidate.slice(-64)}`;
  }

  throw new Error(
    "Use an ECDSA secp256k1 Testnet key in DER or 32-byte raw format.",
  );
}

async function getTestnetAccount(accountId) {
  if (!/^0\.0\.\d+$/.test(accountId)) {
    throw new Error("Enter a valid Hedera account ID in 0.0.x format.");
  }

  const response = await fetch(
    `${HEDERA_TESTNET.mirrorNodeUrl}/api/v1/accounts/${accountId}?transactions=false`,
  );

  if (!response.ok) {
    throw new Error(`Account ${accountId} was not found on Hedera Testnet.`);
  }

  return response.json();
}

function setStatus(message, type = "neutral", transactionReference = "") {
  elements.statusMessage.className = `status-message status-${type}`;
  elements.statusMessage.replaceChildren();

  const text = document.createElement("span");
  text.textContent = message;
  elements.statusMessage.append(text);

  if (transactionReference) {
    const link = document.createElement("a");
    link.href = `${HEDERA_TESTNET.explorerUrl}/transaction/${transactionReference}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "View on HashScan ↗";
    elements.statusMessage.append(link);
  }
}

function readableError(error) {
  const message = [
    error?.shortMessage,
    error?.reason,
    error?.status?.toString?.(),
    error?.message,
  ]
    .filter(Boolean)
    .join(" ");

  if (/blocked from voting/i.test(message)) {
    return "Vote rejected: this account is blocked by the contract.";
  }
  if (/already voted/i.test(message)) {
    return "Vote rejected: this account has already voted.";
  }
  if (/invalid proposal/i.test(message)) {
    return "Vote rejected: the proposal does not exist.";
  }
  if (/insufficient|balance/i.test(message)) {
    return "The account does not have enough Testnet HBAR for the transaction fee.";
  }
  if (/invalid signature|signature/i.test(message)) {
    return "The account ID and private key do not match.";
  }

  return (
    error?.shortMessage ||
    error?.reason ||
    error?.message ||
    "The Hedera Testnet interaction failed."
  );
}

function updateVoterState(nextState) {
  voterState = nextState;
  elements.voterState.textContent = nextState;
  elements.stateDot.className = `state-dot state-${nextState.toLowerCase().replaceAll(" ", "-")}`;
}

function voteButtonText() {
  if (voterState === "Blocked") return "Try blocked vote";
  if (voterState === "Voted") return "Try second vote";
  return "Cast vote";
}

function clearSigningClient() {
  signingWallet = undefined;
  connectedAccountId = "";
  connectedAddress = "";
}

async function startCredentialSession(event) {
  event.preventDefault();

  try {
    const accountId = elements.voterAccountId.value.trim();
    const privateKey = parseEcdsaPrivateKey(elements.voterPrivateKey.value);
    const wallet = new Wallet(privateKey, readProvider);
    const walletAddress = getAddress(wallet.address);
    const account = await getTestnetAccount(accountId);

    if (!account.evm_address) {
      throw new Error(
        "This account has no EVM address. Use an ECDSA Testnet account for the site demo.",
      );
    }

    const accountEvmAddress = getAddress(
      account.evm_address.startsWith("0x")
        ? account.evm_address
        : `0x${account.evm_address}`,
    );

    if (walletAddress !== accountEvmAddress) {
      throw new Error("The account ID and private key do not match.");
    }

    clearSigningClient();
    signingWallet = wallet;
    connectedAccountId = accountId;
    connectedAddress = accountEvmAddress;

    elements.credentialForm.hidden = true;
    elements.sessionDetails.hidden = false;
    elements.activeAccountId.textContent = connectedAccountId;
    elements.accountAddress.textContent = connectedAddress;
    elements.accountAddress.title = connectedAddress;
    elements.openSession.textContent = connectedAccountId;
    updateVoterState(contractAddress ? "Checking contract…" : "Contract not loaded");
    setStatus("Temporary Testnet account session started. The key field has been cleared.", "success");

    if (contractAddress) {
      await refreshContractData();
    }
  } catch (error) {
    setStatus(readableError(error), "error");
  } finally {
    elements.voterPrivateKey.value = "";
  }
}

function forgetCredentialSession() {
  clearSigningClient();
  elements.voterAccountId.value = "";
  elements.voterPrivateKey.value = "";
  elements.credentialForm.hidden = false;
  elements.sessionDetails.hidden = true;
  elements.activeAccountId.textContent = "—";
  elements.accountAddress.textContent = "—";
  elements.openSession.textContent = "Use test account";
  updateVoterState("Not connected");
  renderVoteButtonsDisabled(false);
  setStatus("The temporary account session has been forgotten.", "success");
}

function renderProposals(proposals) {
  elements.proposalGrid.replaceChildren();

  proposals.forEach(({ name, voteCount }, index) => {
    const article = document.createElement("article");
    article.className = "proposal-card";

    const number = document.createElement("span");
    number.className = "proposal-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("h3");
    title.textContent = name;

    const count = document.createElement("p");
    count.className = "vote-count";
    count.textContent = `${voteCount} ${voteCount === 1n ? "vote" : "votes"}`;

    const button = document.createElement("button");
    button.className = "button button-vote";
    button.type = "button";
    button.textContent = voteButtonText();
    button.disabled = !signingWallet || transactionPending;
    button.addEventListener("click", () => castVote(index));

    article.append(number, title, count, button);
    elements.proposalGrid.append(article);
  });
}

async function readProposals(contract) {
  const proposalCount = Number(await contract.getProposalCount());
  const results = await Promise.all(
    Array.from({ length: proposalCount }, (_, index) => contract.getProposal(index)),
  );

  return results.map(([name, voteCount]) => ({ name, voteCount }));
}

async function readWinner(contract) {
  try {
    return await contract.winner();
  } catch {
    return "No votes yet";
  }
}

async function refreshContractData() {
  if (!contractAddress) {
    setStatus("Load a deployed contract first.", "error");
    return;
  }

  try {
    setStatus("Reading the latest contract state…");
    const code = await readProvider.getCode(contractAddress);

    if (code === "0x") {
      throw new Error("No contract exists at this address on Hedera Testnet.");
    }

    const contract = new Contract(contractAddress, CONTRACT_ABI, readProvider);
    const [proposals, winner] = await Promise.all([
      readProposals(contract),
      readWinner(contract),
    ]);

    if (connectedAddress) {
      const stateIndex = Number(await contract.voters(connectedAddress));
      updateVoterState(VOTER_STATES[stateIndex] ?? "Unknown");
    }

    elements.winnerName.textContent = winner;
    renderProposals(proposals);
    setStatus("Contract data refreshed from Hedera Testnet.", "success");
  } catch (error) {
    setStatus(readableError(error), "error");
  }
}

async function loadContract(event) {
  event.preventDefault();

  try {
    contractAddress = normalizeContractAddress(elements.contractAddress.value);
    elements.contractAddress.value = contractAddress;
    localStorage.setItem("voteTopicContractAddress", contractAddress);
    await refreshContractData();
  } catch (error) {
    setStatus(readableError(error), "error");
  }
}

async function castVote(proposalIndex) {
  if (!signingWallet) {
    setStatus("Start a temporary Testnet account session before voting.", "error");
    return;
  }

  if (!contractAddress) {
    setStatus("Load a deployed contract before voting.", "error");
    return;
  }

  try {
    transactionPending = true;
    renderVoteButtonsDisabled(true);
    setStatus("Signing and submitting the vote to Hedera Testnet…");

    const contract = new Contract(contractAddress, CONTRACT_ABI, signingWallet);
    const response = await contract.vote(proposalIndex, { gasLimit: 150_000 });
    const receipt = await response.wait();

    if (receipt.status !== 1) {
      throw new Error("The vote transaction did not succeed.");
    }

    await refreshContractData();
    setStatus("Vote recorded successfully.", "success", response.hash);
  } catch (error) {
    if (voterState === "Blocked") {
      setStatus("Vote rejected: this account is blocked by the contract.", "error");
    } else if (voterState === "Voted") {
      setStatus("Vote rejected: this account has already voted.", "error");
    } else {
      setStatus(readableError(error), "error");
    }
  } finally {
    transactionPending = false;
    renderVoteButtonsDisabled(false);
  }
}

function renderVoteButtonsDisabled(disabled) {
  document.querySelectorAll(".button-vote").forEach((button) => {
    button.disabled = disabled || !signingWallet;
    button.textContent = voteButtonText();
  });
}

async function copyConnectedAddress() {
  if (!connectedAddress) return;

  try {
    await navigator.clipboard.writeText(connectedAddress);
    setStatus("Contract-facing address copied to the clipboard.", "success");
  } catch {
    setStatus("Could not copy automatically. Select the address and copy it manually.", "error");
  }
}

function restoreContractAddress() {
  const storedAddress = localStorage.getItem("voteTopicContractAddress");
  const initialAddress = DEFAULT_CONTRACT_ADDRESS || storedAddress || "";

  if (initialAddress) {
    try {
      contractAddress = normalizeContractAddress(initialAddress);
      elements.contractAddress.value = contractAddress;
      refreshContractData();
    } catch {
      localStorage.removeItem("voteTopicContractAddress");
    }
  }
}

elements.openSession.addEventListener("click", () => {
  elements.voterAccountId.focus();
  elements.voterAccountId.scrollIntoView({ behavior: "smooth", block: "center" });
});
elements.credentialForm.addEventListener("submit", startCredentialSession);
elements.forgetAccount.addEventListener("click", forgetCredentialSession);
elements.contractForm.addEventListener("submit", loadContract);
elements.refreshData.addEventListener("click", refreshContractData);
elements.copyAddress.addEventListener("click", copyConnectedAddress);
window.addEventListener("beforeunload", clearSigningClient);

restoreContractAddress();

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VoteTopic {
    // Bound proposal-dependent loops so deployment and winner queries stay practical.
    uint256 public constant MAX_PROPOSALS = 50;

    // A proposal contains its readable name and current number of votes.
    struct Proposal {
        string name;
        uint256 voteCount;
    }

    // Eligible is the first value because it is the default state for addresses
    // that have not been explicitly added to the blocklist or already voted.
    enum VoterState {
        Eligible,
        Blocked,
        Voted
    }

    // Store the proposals while exposing them through controlled read functions.
    Proposal[] private proposals;

    // Public visibility creates a getter for inspecting an address's voter state.
    mapping(address => VoterState) public voters;

    // Record each successful vote in transaction logs for transparency and auditing.
    event VoteCast(address indexed voter, uint256 indexed proposalIndex);

    // Initialize the proposals and fixed blocklist during deployment.
    constructor(
        string[] memory proposalNames,
        address[] memory blockedAddresses
    ) {
        require(proposalNames.length > 0, "At least one proposal is required.");
        require(
            proposalNames.length <= MAX_PROPOSALS,
            "Too many proposals."
        );

        for (uint256 i = 0; i < proposalNames.length; i++) {
            require(
                bytes(proposalNames[i]).length > 0,
                "Proposal name cannot be empty."
            );

            // Use strings for readable, flexible proposal names, but limit them to
            // 31 bytes so Solidity can store each short string in one storage slot.
            require(
                bytes(proposalNames[i]).length <= 31,
                "Proposal name must be 31 bytes or fewer."
            );

            proposals.push(
                Proposal({
                    name: proposalNames[i],
                    voteCount: 0
                })
            );
        }

        for (uint256 i = 0; i < blockedAddresses.length; i++) {
            require(
                blockedAddresses[i] != address(0),
                "Blocked address cannot be the zero address."
            );

            voters[blockedAddresses[i]] = VoterState.Blocked;
        }
    }

    // Return the number of proposals stored in the contract.
    function getProposalCount() external view returns (uint256) {
        return proposals.length;
    }

    // Return the name and vote count of one proposal.
    function getProposal(
        uint256 proposalIndex
    ) external view returns (string memory name, uint256 voteCount) {
        require(proposalIndex < proposals.length, "Invalid proposal index.");

        Proposal storage proposal = proposals[proposalIndex];
        return (proposal.name, proposal.voteCount);
    }

    // Cast one vote. Only eligible addresses can successfully call this function.
    function vote(uint256 proposalIndex) external {
        VoterState voterState = voters[msg.sender];

        require(
            voterState != VoterState.Blocked,
            "You are blocked from voting."
        );
        require(
            voterState != VoterState.Voted,
            "You have already voted."
        );
        require(proposalIndex < proposals.length, "Invalid proposal index.");

        voters[msg.sender] = VoterState.Voted;
        proposals[proposalIndex].voteCount += 1;

        emit VoteCast(msg.sender, proposalIndex);
    }

    // Return the proposal with the highest vote count. In a tie, the proposal
    // appearing first in the constructor input wins. Revert if nobody has voted.
    function winner() external view returns (string memory result) {
        uint256 maxVoteCount = 0;

        for (uint256 i = 0; i < proposals.length; i++) {
            if (proposals[i].voteCount > maxVoteCount) {
                maxVoteCount = proposals[i].voteCount;
                result = proposals[i].name;
            }
        }

        require(maxVoteCount > 0, "No votes have been cast.");
    }
}

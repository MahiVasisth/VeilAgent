// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC8004Deployer} from "../../script/lib/ERC8004Deployer.sol";
import {IERC8004Identity} from "../../src/interfaces/erc8004/IERC8004Identity.sol";
import {IERC8004Validation} from "../../src/interfaces/erc8004/IERC8004Validation.sol";
import {IAssuranceTier} from "../../src/interfaces/IAssuranceTier.sol";
import {PolicyRegistry} from "../../src/core/PolicyRegistry.sol";
import {PrivateValidationRegistry} from "../../src/core/PrivateValidationRegistry.sol";
import {TreasuryAction} from "../../src/consumers/TreasuryAction.sol";
import {MockForwarder} from "../../src/mocks/MockForwarder.sol";

/// @notice Shared Phase 2 setup: fresh ERC-8004 registries, two agents, the Veil8004 core, the treasury consumer
///         and a MockForwarder whose transmitter stands in for the local runner.
abstract contract VeilFixture is Test {
    bytes32 constant SANCTIONS = keccak256("SANCTIONS_SCREEN_V1");
    bytes32 constant OTHER_POLICY = keccak256("OTHER_POLICY_V1");
    uint64 constant WINDOW = 1 days;
    bytes32 constant W1_ID = keccak256("veil8004.local.w1-validator");
    bytes10 constant W1_NAME = bytes10("0123456789");

    IERC8004Identity identity;
    IERC8004Validation validation;
    PolicyRegistry policies;
    PrivateValidationRegistry registry;
    TreasuryAction treasury;
    MockForwarder forwarder;

    address policyOwner = makeAddr("policyOwner");
    address agentOwner = makeAddr("agentOwner");
    address agentWallet = makeAddr("agentWallet");
    address operator = makeAddr("treasuryOperator");
    address client = makeAddr("client");
    address stranger = makeAddr("stranger");
    address transmitter = makeAddr("localRunner");
    address workflowOwner = makeAddr("workflowOwner");

    uint256 agentId;
    uint256 otherAgentId;

    function setUp() public virtual {
        identity = IERC8004Identity(ERC8004Deployer.deployIdentity());
        validation = IERC8004Validation(ERC8004Deployer.deployValidation(address(identity)));

        vm.prank(agentOwner);
        agentId = identity.register();
        vm.prank(stranger);
        otherAgentId = identity.register();

        forwarder = new MockForwarder();
        forwarder.setTransmitter(transmitter, true);

        policies = new PolicyRegistry();
        vm.startPrank(policyOwner);
        policies.createPolicy(SANCTIONS, keccak256("sanctions screen"), IAssuranceTier.Tier.Don, WINDOW, 0);
        policies.createPolicy(OTHER_POLICY, keccak256("other"), IAssuranceTier.Tier.Don, WINDOW, 0);
        vm.stopPrank();

        registry = new PrivateValidationRegistry(address(forwarder), policies, identity, validation);
        registry.setExpectedWorkflowId(W1_ID);
        treasury = new TreasuryAction(registry, identity, operator);
    }

    // ---- helpers -------------------------------------------------------------------------------

    function commit(uint256 agent, bytes32 policyId, string memory input, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(agent, policyId, keccak256(bytes(input)), salt));
    }

    function request(address who, uint256 agent, bytes32 policyId, bytes32 commitment) internal returns (bytes32 id) {
        vm.prank(who);
        id = registry.requestPrivate(agent, policyId, commitment);
    }

    function w1Report(bytes32 requestId, bytes32 commitment, bool passed, bytes32 policyId, uint64 expiry)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(requestId, commitment, passed, policyId, uint8(IAssuranceTier.Tier.Don), expiry);
    }

    function deliver(bytes memory report) internal {
        vm.prank(transmitter);
        forwarder.deliver(address(registry), W1_ID, W1_NAME, workflowOwner, bytes2(0x0001), report);
    }

    /// @dev Request + report in one go. Returns the request id.
    function recorded(address who, uint256 agent, bytes32 policyId, string memory input, bytes32 salt, bool passed)
        internal
        returns (bytes32 id)
    {
        bytes32 c = commit(agent, policyId, input, salt);
        id = request(who, agent, policyId, c);
        deliver(w1Report(id, c, passed, policyId, uint64(block.timestamp + WINDOW)));
    }

    /// @dev ERC-8004 setAgentWallet: EIP-712 signature by the new wallet, domain ("ERC8004IdentityRegistry", "1").
    function _setAgentWallet(uint256 agent, address owner, address wallet, uint256 walletKey) internal {
        uint256 deadline = block.timestamp + 60;
        bytes32 typehash = keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(identity)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(typehash, agent, wallet, owner, deadline)))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, digest);
        vm.prank(owner);
        identity.setAgentWallet(agent, wallet, deadline, abi.encodePacked(r, s, v));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";

/// @notice Deploys our own Semaphore V4 (docs/phase0.md Q7) against poseidon-solidity's published PoseidonT3 at its
///         canonical address (S-8):
///         1. PoseidonT3 goes to 0x3333333C…3B93 through the deterministic CREATE2 proxy (present on Anvil and on Monad
///            testnet), unless code is already there. Payload: script/lib/PoseidonT3.create2.json.
///         2. Semaphore's unlinked creation code is read from its forge artifact, the PoseidonT3 link placeholder is
///            replaced with that address, and the result is deployed.
///         Forge never deploys its own PoseidonT3: under via-IR it is 29,315 bytes, over the EIP-170 limit, and
///         forge's `libraries` setting does not match sources outside the project root.
library SemaphoreDeployer {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant CREATE2_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant POSEIDON_T3 = 0x3333333C0A88F9BE4fd23ed0536F9B6c427e3B93;
    /// @dev The library's fully qualified name as solc sees it; its link placeholder is derived from this.
    string internal constant POSEIDON_T3_FQN = "../node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3";

    error Create2ProxyMissing();
    error PoseidonT3DeployFailed();
    error PlaceholderNotFound();
    error UnlinkedLibraryLeft();
    error SemaphoreDeployFailed();

    /// @dev Inside a broadcast, the CREATE2 call is sent as a transaction from the broadcaster.
    function ensurePoseidonT3() internal returns (address) {
        if (POSEIDON_T3.code.length != 0) return POSEIDON_T3;
        if (CREATE2_PROXY.code.length == 0) revert Create2ProxyMissing();
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/script/lib/PoseidonT3.create2.json"));
        (bool ok,) = CREATE2_PROXY.call(vm.parseJsonBytes(json, ".data"));
        if (!ok || POSEIDON_T3.code.length == 0) revert PoseidonT3DeployFailed();
        return POSEIDON_T3;
    }

    /// @notice Semaphore's creation code with PoseidonT3 linked to the canonical address.
    function linkedSemaphoreCode() internal view returns (bytes memory) {
        string memory artifact = vm.readFile(string.concat(vm.projectRoot(), "/out/Semaphore.sol/Semaphore.json"));
        string memory code = vm.parseJsonString(artifact, ".bytecode.object");
        string memory placeholder = _placeholder(POSEIDON_T3_FQN);
        if (vm.indexOf(code, placeholder) == type(uint256).max) revert PlaceholderNotFound();
        string memory addr = vm.replace(vm.toLowercase(vm.toString(POSEIDON_T3)), "0x", "");
        code = vm.replace(code, placeholder, addr);
        if (vm.indexOf(code, "__$") != type(uint256).max) revert UnlinkedLibraryLeft();
        return vm.parseBytes(code);
    }

    /// @notice Deploys PoseidonT3 if needed, then Semaphore(verifier). Returns the Semaphore address.
    function deploySemaphore(ISemaphoreVerifier verifier) internal returns (address semaphore) {
        ensurePoseidonT3();
        bytes memory init = abi.encodePacked(linkedSemaphoreCode(), abi.encode(verifier));
        assembly {
            semaphore := create(0, add(init, 0x20), mload(init))
        }
        if (semaphore == address(0)) revert SemaphoreDeployFailed();
    }

    /// @dev solc's link placeholder: "__$" ++ the first 34 hex characters of keccak256(fqn) ++ "$__".
    function _placeholder(string memory fqn) private pure returns (string memory) {
        bytes memory h = bytes(vm.toString(keccak256(bytes(fqn)))); // "0x" ++ 64 lowercase hex
        bytes memory out = new bytes(40);
        out[0] = "_";
        out[1] = "_";
        out[2] = "$";
        for (uint256 i; i < 34; i++) out[3 + i] = h[2 + i];
        out[37] = "$";
        out[38] = "_";
        out[39] = "_";
        return string(out);
    }
}

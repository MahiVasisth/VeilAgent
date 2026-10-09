// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1967Proxy} from "erc-8004/ERC1967Proxy.sol";
import {HardhatMinimalUUPS} from "erc-8004/HardhatMinimalUUPS.sol";
import {IdentityRegistryUpgradeable} from "erc-8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "erc-8004/ReputationRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "erc-8004/ValidationRegistryUpgradeable.sol";

/// @notice Deploys fresh ERC-8004 registries the way erc-8004-contracts does in `test/upgradeable.ts`:
///         ERC1967Proxy(HardhatMinimalUUPS, initialize(identity)) -> upgradeToAndCall(impl, initialize(...)).
///         The registry implementations disable initializers and `initialize` is `reinitializer(2) onlyOwner`,
///         so plain `new` cannot be used (docs/phase0.md I-7). The caller becomes the proxies' owner.
library ERC8004Deployer {
    function deployIdentity() internal returns (address) {
        address proxy = _minimalProxy(address(0));
        HardhatMinimalUUPS(proxy).upgradeToAndCall(
            address(new IdentityRegistryUpgradeable()), abi.encodeCall(IdentityRegistryUpgradeable.initialize, ())
        );
        return proxy;
    }

    function deployReputation(address identity) internal returns (address) {
        address proxy = _minimalProxy(identity);
        HardhatMinimalUUPS(proxy).upgradeToAndCall(
            address(new ReputationRegistryUpgradeable()),
            abi.encodeCall(ReputationRegistryUpgradeable.initialize, (identity))
        );
        return proxy;
    }

    function deployValidation(address identity) internal returns (address) {
        address proxy = _minimalProxy(identity);
        HardhatMinimalUUPS(proxy).upgradeToAndCall(
            address(new ValidationRegistryUpgradeable()),
            abi.encodeCall(ValidationRegistryUpgradeable.initialize, (identity))
        );
        return proxy;
    }

    function _minimalProxy(address identity) private returns (address) {
        return address(
            new ERC1967Proxy(address(new HardhatMinimalUUPS()), abi.encodeCall(HardhatMinimalUUPS.initialize, (identity)))
        );
    }
}

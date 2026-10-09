// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Byte-substring search for the leak tests.
library BytesSearch {
    function contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > hay.length) return false;
        for (uint256 i; i + needle.length <= hay.length; i++) {
            if (hay[i] != needle[0]) continue;
            bool ok = true;
            for (uint256 j = 1; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}

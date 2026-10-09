// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IAssuranceTier
/// @notice Shared vocabulary for what a verifier is trusting when it reads a Veil8004 result.
/// @dev The tier is recorded and displayed, not enforced on-chain. Enforcement is specified in
///      docs/extension-draft.md.
interface IAssuranceTier {
    /// @notice What stands behind a result.
    /// @custom:value PublicReputation Public ERC-8004 reputation only; no private computation.
    /// @custom:value Don             A standard CRE workflow: DON consensus, no enclave. Node operators see inputs.
    /// @custom:value TeeDon          A CRE Confidential Workflow: DON consensus over an enclave run.
    /// @custom:value Zk              A zero-knowledge proof checked on-chain.
    enum Tier {
        PublicReputation,
        Don,
        TeeDon,
        Zk
    }

    /// @notice Lifecycle of a private validation request.
    /// @custom:value None    No such request.
    /// @custom:value Pending Requested; no report recorded yet.
    /// @custom:value Passed  A report recorded a pass.
    /// @custom:value Failed  A report recorded a fail.
    enum Status {
        None,
        Pending,
        Passed,
        Failed
    }
}

# Vendored: Chainlink CRE ReceiverTemplate

Chainlink does not publish `ReceiverTemplate` in a package. `@chainlink/contracts@1.5.0` ships
`keystone/interfaces/IReceiver.sol` but no template, and `smartcontractkit/chainlink-evm`
(`contracts/cre/src/v1/`) has `IReceiver` and `KeystoneForwarder` only. The template is
copied into each starter in `smartcontractkit/cre-templates`, and these files are copied
from there unmodified.

- Repo: https://github.com/smartcontractkit/cre-templates
- Commit: `d0223f31182c76bc36b1cc9d47b13b18efcf2bf6` (HEAD on 2026-10-08)
- Path: `starter-templates/event-reactor/event-reactor-ts/contracts/evm/src/`
- License: MIT (see `LICENSE`)

| File | sha256 |
|---|---|
| `src/ReceiverTemplate.sol` | `cebb2e698a20ca6ba41e8bff1777a537df0715c923d9e263f2b5b3f8fe06677d` |
| `src/IReceiver.sol` | `dae0906d7de2e634f14d3b6794194d5bae38803e76e8029710611c7348c5a5e0` |
| `src/IERC165.sol` | `c6a3b82a876e50eba9cd4673a712f861eca2a476cd2ad28fc0f26e66ae5f2dda` |

This copy was chosen because it imports only `@openzeppelin/contracts/access/Ownable.sol`.
Other templates in the same repo (for example `automation-migration`) import pinned
`@openzeppelin/contracts@5.0.2` paths and make the storage fields `internal`; the
public interface is identical.

Upstream `IReceiver` for reference:
`smartcontractkit/chainlink-evm@b723176adfe8f2e9eff47730e21a1ac8f64b46d7:contracts/cre/src/v1/interfaces/IReceiver.sol`.

Do not edit these files. To upgrade, re-copy from a newer commit and update this table.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IComplianceRegistry
 * @notice Interfaccia del registro di compliance on-chain.
 *         Espone whitelist/blacklist, scadenze KYC e mapping "wallet della posizione".
 */
interface IComplianceRegistry {
    /* ========= Views ========= */

    function isWhitelisted(address account) external view returns (bool);
    function isBlacklisted(address account) external view returns (bool);
    function kycexpiry(address account) external view returns (uint256);

    /// @notice Verifica se un transfer è ammesso (inclusi controlli KYC/AML base).
    function isTransferAllowed(address from, address to, uint256 amount) external view returns (bool);

    /// @notice Wallet "della posizione" (custodial o self-custody) associato a un investorId hashato.
    function getPositionWallet(bytes32 investorIdHash) external view returns (address);

    /* ======== Mutations (role-gated) ======== */

    /// @notice Hook hard che fa revert se la movimentazione non è consentita.
    function enforceTransfer(address from, address to, uint256 amount) external view;

    function setWhitelist(address account, bool allowed) external;
    function setBlacklist(address account, bool banned) external;
    function setKycExpiry(address account, uint256 expiry) external;

    function setPositionWallet(bytes32 investorIdHash, address wallet) external;

    /* ========= Events ========= */

    event WhitelistSet(address indexed account, bool allowed);
    event BlacklistSet(address indexed account, bool banned);
    event KycExpirySet(address indexed account, uint256 expiry);
    event PositionWalletSet(bytes32 indexed investorIdHash, address indexed wallet);
}

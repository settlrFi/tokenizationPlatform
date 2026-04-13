// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";

/**
 * @title ComplianceRegistry (UUPS Upgradeable)
 * @notice Registro di compliance on-chain: whitelist/blacklist/KYC + mapping wallet della posizione.
 *         Da deployare dietro proxy ERC1967 (UUPS).
 *
 * IMPORTANT:
 * - Nel resto del sistema (token ecc.) devi usare SEMPRE l'indirizzo del PROXY.
 * - L'implementation serve solo come "codice" sostituibile.
 */
contract ComplianceRegistry is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IComplianceRegistry
{
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(address => bool) private _whitelist;
    mapping(address => bool) private _blacklist;
    mapping(address => uint256) private _kycExpiry;

    // investorIdHash -> wallet della posizione
    mapping(bytes32 => address) private _positionWallet;

    /// @dev Disabilita initializer SOLO sull'implementation (best practice).
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializer (sostituisce il constructor nel pattern proxy).
     * @param admin governance/admin (tipicamente multisig/timelock)
     * @param complianceOfficer ruolo operativo che aggiorna whitelist/blacklist/KYC
     */
    function initialize(address admin, address complianceOfficer) public initializer {
        require(admin != address(0), "Invalid admin");
        require(complianceOfficer != address(0), "Invalid officer");

        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, complianceOfficer);
    }

    /* ========= Views ========= */

    function isWhitelisted(address account) external view override returns (bool) {
        return _isAccountOk(account);
    }

    function isBlacklisted(address account) external view override returns (bool) {
        return _blacklist[account];
    }

    function kycexpiry(address account) external view override returns (uint256) {
        return _kycExpiry[account];
    }

    function isTransferAllowed(address from, address to, uint256 /*amount*/)
        external
        view
        override
        returns (bool)
    {
        // Mint: from == 0x0 -> controlla solo il destinatario
        if (from == address(0)) return _isAccountOk(to);
        // Burn: to == 0x0 -> controlla solo il mittente
        if (to == address(0)) return _isAccountOk(from);
        // Transfer standard
        return _isAccountOk(from) && _isAccountOk(to);
    }

    function getPositionWallet(bytes32 investorIdHash) external view override returns (address) {
        return _positionWallet[investorIdHash];
    }

    /// @notice Hook hard che fa revert se la movimentazione non è consentita.
    function enforceTransfer(address from, address to, uint256 amount) external view override {
        // `require` è ok anche in view (non modifica stato).
        require(
            _isTransferAllowedInternal(from, to, amount),
            "Compliance: transfer not allowed"
        );
    }

    /* ======== Mutations (role-gated) ======== */

    function setWhitelist(address account, bool allowed) external override onlyRole(COMPLIANCE_ROLE) {
        _whitelist[account] = allowed;
        emit WhitelistSet(account, allowed);
    }

    function setBlacklist(address account, bool banned) external override onlyRole(COMPLIANCE_ROLE) {
        _blacklist[account] = banned;
        emit BlacklistSet(account, banned);
    }

    function setKycExpiry(address account, uint256 expiry) external override onlyRole(COMPLIANCE_ROLE) {
        _kycExpiry[account] = expiry;
        emit KycExpirySet(account, expiry);
    }

    function setPositionWallet(bytes32 investorIdHash, address wallet)
        external
        override
        onlyRole(COMPLIANCE_ROLE)
    {
        _positionWallet[investorIdHash] = wallet;
        emit PositionWalletSet(investorIdHash, wallet);
    }

    /* ========= Internal ========= */

    function _isTransferAllowedInternal(address from, address to, uint256 /*amount*/)
        internal
        view
        returns (bool)
    {
        if (from == address(0)) return _isAccountOk(to);
        if (to == address(0)) return _isAccountOk(from);
        return _isAccountOk(from) && _isAccountOk(to);
    }

    function _isAccountOk(address a) internal view returns (bool) {
        if (a == address(0)) return false;
        if (_blacklist[a]) return false;
        if (!_whitelist[a]) return false;
        if (_kycExpiry[a] <= block.timestamp) return false;
        return true;
    }

    /**
     * @dev UUPS authorization: solo la governance può fare upgrade.
     *      Questo si applica al PROXY (ruoli nello storage del proxy).
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        view
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newImplementation != address(0), "Invalid implementation");
    }

    // Storage gap per upgrade futuri (append-only)
    uint256[50] private __gap;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";

/// @title FundVault4626
/// @notice Vault ERC-4626 che accetta un asset (es. USDC) ed emette shares ERC20.
///         Applica la compliance del ComplianceRegistry su ogni flusso (deposit/mint/withdraw/redeem e transfer di shares).
///         Espone un NAV/yield "virtuale" tramite `virtualAssetBuffer` per demo/test.
/// @dev    Le shares sono ERC20 con Permit (EIP-2612).
contract FundVault4626 is ERC4626, ERC20Permit, Pausable, AccessControl {
    
    // ===== Ruoli =====
    /// @notice Ruolo operativo per eventuali funzioni di compliance future (simmetria con altri contratti).
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    /// @notice Può aggiornare il buffer NAV virtuale.
    bytes32 public constant NAV_SETTER_ROLE = keccak256("NAV_SETTER_ROLE");

    // ===== Stato =====
    /// @notice Registro di compliance condiviso (whitelist/blacklist/KYC).
    IComplianceRegistry public registry;
    /// @notice Buffer di asset "virtuali" aggiunti a totalAssets() per simulare NAV/yield.
    uint256 public virtualAssetBuffer;

    // ===== Eventi =====
    /// @notice Emesso quando cambia il NAV virtuale.
    event NavUpdated(uint256 virtualBuffer, uint256 totalAssetsNow);
    /// @notice Emesso quando viene aggiornato l'indirizzo del registry.
    event RegistryUpdated(address indexed newRegistry);

    // ===== Costruttore =====
    /// @param asset_           Asset sottostante accettato dal vault (es. USDC).
    /// @param name_            Nome delle shares (ERC20).
    /// @param symbol_          Simbolo delle shares (ERC20).
    /// @param admin            Indirizzo che riceve il DEFAULT_ADMIN_ROLE.
    /// @param complianceOfficer Indirizzo che riceve il COMPLIANCE_ROLE (riservato per estensioni future).
    /// @param navSetter        Indirizzo che può aggiornare il NAV virtuale.
    /// @param registry_        Indirizzo del ComplianceRegistry da usare per i controlli.
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin,
        address complianceOfficer,
        address navSetter,
        IComplianceRegistry registry_
    )
        ERC20(name_, symbol_)        // inizializza il nome/simbolo delle shares
        ERC20Permit(name_)           // abilita EIP-2612 Permit per le shares
        ERC4626(asset_)              // imposta l'asset sottostante del vault
    {
        // Assegna ruoli
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE,     complianceOfficer);
        _grantRole(NAV_SETTER_ROLE,     navSetter);

        // Set iniziale registry (non nullo)
        require(address(registry_) != address(0), "Vault: registry is zero");
        registry = registry_;
        emit RegistryUpdated(address(registry_));
    }

    // ===== NAV / Yield =====

    /// @notice Imposta il buffer virtuale usato per simulare NAV/yield.
    /// @dev    Solo NAV_SETTER_ROLE. Aggiorna anche un evento con il nuovo totalAssets().
    function setVirtualAssetBuffer(uint256 newBuffer) external onlyRole(NAV_SETTER_ROLE) {
        virtualAssetBuffer = newBuffer;
        emit NavUpdated(newBuffer, totalAssets());
    }
    
    /// @notice Ritorna il totale asset del vault = asset reali + buffer virtuale.
    /// @dev    Il buffer influenza le conversioni shares<->asset secondo ERC-4626.
    function totalAssets() public view override returns (uint256) {
        return super.totalAssets() + virtualAssetBuffer;
    }

    /// @notice Risolve l'override multiplo di `decimals()` (esposto sia da ERC20 che da ERC4626).
    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }

    // ===== Flussi ERC-4626 con compliance =====
    // Applichiamo controlli prima di delegare a ERC4626; `_update` intercetterà comunque il mint/burn/transfer delle shares.

    /// @inheritdoc ERC4626
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        returns (uint256 shares)
    {
        // Controlli di compliance sull'attore che deposita e su chi riceve le shares
        _enforceAccountCompliant(msg.sender);
        _enforceAccountCompliant(receiver);
        return super.deposit(assets, receiver);
    }

    /// @inheritdoc ERC4626
    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        returns (uint256 assets)
    {
        _enforceAccountCompliant(msg.sender);
        _enforceAccountCompliant(receiver);
        return super.mint(shares, receiver);
    }

    /// @inheritdoc ERC4626
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        whenNotPaused
        returns (uint256 shares)
    {
        _enforceAccountCompliant(msg.sender);
        _enforceAccountCompliant(receiver);
        _enforceAccountCompliant(owner);
        return super.withdraw(assets, receiver, owner);
    }

    /// @inheritdoc ERC4626
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        whenNotPaused
        returns (uint256 assets)
    {
        _enforceAccountCompliant(msg.sender);
        _enforceAccountCompliant(receiver);
        _enforceAccountCompliant(owner);
        return super.redeem(shares, receiver, owner);
    }

    // ===== Transfer di shares con compliance =====

    /// @notice Hook unico di OZ v5: intercetta mint/burn/transfer delle shares.
    /// @dev    Applica pausa e compliance su TUTTE le movimentazioni di shares.
    function _update(address from, address to, uint256 value) internal override(ERC20) {
        require(!paused(), "Vault: paused");

        if (value != 0) {
            // Usa l'enforcement del registry per ottenere revert motivati ed omogenei
            // - mint   (from == 0) -> controlla `to`
            // - burn   (to   == 0) -> controlla `from`
            // - transfer          -> controlla `from` e `to`
            registry.enforceTransfer(from, to, value);
        }

        super._update(from, to, value);
    }

    // ===== Admin =====

    /// @notice Pausa tutte le operazioni annotate `whenNotPaused` e i transfer di shares.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }

    /// @notice Riprende le operazioni.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /// @notice Aggiorna l'indirizzo del ComplianceRegistry (come su SecurityToken).
    /// @dev    Solo admin; deve puntare a un contratto che implementa `IComplianceRegistry`.
    function setRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRegistry != address(0), "Vault: registry is zero");
        registry = IComplianceRegistry(newRegistry);
        emit RegistryUpdated(newRegistry);
    }

    // ===== Internals =====

    /// @notice Enforce "account compliant" anche fuori da un contesto di vero transfer.
    /// @dev    Usiamo (from=to=account, amount=1) solo per attivare i check e gli errori custom del registry.
    function _enforceAccountCompliant(address account) internal view {
        registry.enforceTransfer(account, account, 1);
    }

    // ===== ERC165 support (tramite AccessControl) =====

    /// @inheritdoc AccessControl
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

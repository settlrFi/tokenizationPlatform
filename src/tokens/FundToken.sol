// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SecurityTokenBase} from "./SecurityTokenBase.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * FundToken (Constant NAV / MMF-like)
 * - La quota vale concettualmente 1$ (costante).
 * - Il rendimento si applica aumentando le quote via un indice globale indexRay = I_t (1e18).
 *
 * Modello:
 *   visibleBalance(A)    = baseBalance(A) * indexRay / 1e18
 *   visibleTotalSupply   = totalBase * indexRay / 1e18
 *
 * Mint/Burn/Transfer ricevono amount in "visibile" (quote), ma contabilizzano in BASE:
 *   base = visible * 1e18 / indexRay
 */
contract FundToken is SecurityTokenBase {
    using Math for uint256;

    // Mantengo questo nome per compatibilità con la tua dApp attuale
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");

    // indice globale (I_t) in 1e18
    uint256 public indexRay;

    // base balances (b_A) e supply base
    mapping(address => uint256) private _baseBalances;
    uint256 private _totalBase;

    struct FundMetadata {
        string fundName;
        string managerName;
        string depositoryName;
        string shareClass;
        string isin;
        string termsUri;
    }

    FundMetadata public meta;

    event FundMetadataUpdated(FundMetadata meta);
    event IndexUpdated(uint256 oldIndexRay, uint256 newIndexRay, uint64 timestamp);
    event BaseTransfer(address indexed from, address indexed to, uint256 baseAmount, uint256 visibleAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initializeFund(
        string memory name_,
        string memory symbol_,
        address admin,
        address complianceOfficer,
        address initialRegistry,
        address referenceOracle_ // resta per compatibilità con SecurityTokenBase (anche se Fund non lo usa per accounting)
    ) external initializer {
        __SecurityTokenBase_init(name_, symbol_, admin, complianceOfficer, initialRegistry, referenceOracle_);

        // admin può aggiornare indice (yield)
        _grantRole(NAV_UPDATER_ROLE, admin);

        // indice iniziale = 1.0
        indexRay = 1e18;

        _totalBase = 0;
    }

    function setFundMetadata(FundMetadata calldata m) external onlyRole(REGISTRY_ROLE) {
        meta = m;
        emit FundMetadataUpdated(m);
    }

    // ===== Views =====

    function currentIndexRay() external view returns (uint256) {
        return indexRay;
    }

    function baseBalanceOf(address account) external view returns (uint256) {
        return _baseBalances[account];
    }

    function totalBaseSupply() external view returns (uint256) {
        return _totalBase;
    }

    // ERC20 visible supply / balances
    function totalSupply() public view override returns (uint256) {
        return Math.mulDiv(_totalBase, indexRay, 1e18);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return Math.mulDiv(_baseBalances[account], indexRay, 1e18);
    }

    // ===== Index update =====

    /**
     * @notice Imposta direttamente l'indice globale I_t (1e18).
     *         Se vuoi solo crescita, lasciamo il check new >= old.
     */
    function setIndexRay(uint256 newIndexRay, uint64 timestamp) public onlyRole(NAV_UPDATER_ROLE) {
        require(newIndexRay > 0, "INDEX=0");
        uint256 old = indexRay;
        require(newIndexRay >= old, "INDEX_DOWN");
        indexRay = newIndexRay;
        emit IndexUpdated(old, newIndexRay, timestamp);
    }

    /**
     * @notice Wrapper compatibile con la tua UI attuale.
     * @dev Qui "value" NON è più NAV oracle: è il nuovo indexRay (1e18).
     */
    function setNavAndRebase(uint256 value, uint64 timestamp) external onlyRole(NAV_UPDATER_ROLE) {
        setIndexRay(value, timestamp);
    }

    // ===== Internal helpers =====

    function _toBase(uint256 visibleAmount) internal view returns (uint256) {
        uint256 idx = indexRay;
        require(idx > 0, "INDEX=0");
        return Math.mulDiv(visibleAmount, 1e18, idx);
    }

    // ===== Core accounting override =====
    function _update(address from, address to, uint256 value)
        internal
        override
        whenNotPaused
    {
        // lock check (in VISIBLE units)
        if (from != address(0)) {
            uint256 balFromVisible = balanceOf(from);
            uint256 lockedFrom = _locked[from]; // stored in visible units
            require(balFromVisible >= lockedFrom, "Locked exceeds balance");
            uint256 spendable = balFromVisible - lockedFrom;
            require(value <= spendable, "Locked balance");
        }

        // compliance check (in VISIBLE units)
        registry.enforceTransfer(from, to, value);

        // convert visible -> base
        uint256 baseValue = _toBase(value);

        // ✅ IMPORTANT: evita baseValue=0 per importi troppo piccoli quando index > 1
        require(value == 0 || baseValue > 0, "AMOUNT_TOO_SMALL");

        // mint
        if (from == address(0)) {
            _totalBase += baseValue;
            _baseBalances[to] += baseValue;

            emit Transfer(address(0), to, value);
            emit BaseTransfer(address(0), to, baseValue, value);
            return;
        }

        // burn
        if (to == address(0)) {
            uint256 fromB = _baseBalances[from];
            require(fromB >= baseValue, "burn exceeds balance");
            _baseBalances[from] = fromB - baseValue;
            _totalBase -= baseValue;

            emit Transfer(from, address(0), value);
            emit BaseTransfer(from, address(0), baseValue, value);
            return;
        }

        // transfer
        uint256 fromB2 = _baseBalances[from];
        require(fromB2 >= baseValue, "transfer exceeds balance");
        _baseBalances[from] = fromB2 - baseValue;
        _baseBalances[to] += baseValue;

        emit Transfer(from, to, value);
        emit BaseTransfer(from, to, baseValue, value);
    }

    uint256[45] private __gapFund;
}

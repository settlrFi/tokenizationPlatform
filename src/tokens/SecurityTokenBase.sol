// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IComplianceRegistry} from "./interfaces/IComplianceRegistry.sol";
import {IReferenceOracle} from "./interfaces/IReferenceOracle.sol";

/**
 * @notice Core comune, Beacon-ready (NO UUPS).
 *         + reference oracle condiviso (valore esterno indicativo/ufficiale).
 */
abstract contract SecurityTokenBase is
    Initializable,
    ERC20Upgradeable,
    ERC20PermitUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable
{
    /* ========= Roles ========= */
    bytes32 public constant COMPLIANCE_ROLE       = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant MINTER_ROLE           = keccak256("MINTER_ROLE");
    bytes32 public constant DEPOSITARY_ROLE       = keccak256("DEPOSITARY_ROLE");
    bytes32 public constant REGISTRY_ROLE         = keccak256("REGISTRY_ROLE");
    bytes32 public constant PLATFORM_ROLE         = keccak256("PLATFORM_ROLE");
    bytes32 public constant FORCED_TRANSFER_ROLE  = keccak256("FORCED_TRANSFER_ROLE");
    bytes32 public constant PAUSER_ROLE           = keccak256("PAUSER_ROLE");

    /* ========= External Modules ========= */
    IComplianceRegistry public registry;

    /* ========= Reference Oracle (shared) ========= */
    IReferenceOracle public refOracle;
    bytes32 internal _refId; // derivato dall'address del token (proxy)

    event ReferenceOracleSet(address indexed oracle, bytes32 indexed refId);

    /* ========= Redemption Locking ========= */
    mapping(address => uint256) internal _locked;

    /* ========= LMT ========= */
    uint256 public maxDailyRedemptionBps;
    uint256 public exitFeeBps;
    mapping(uint256 => uint256) public redeemedByDay;

    /* ========= Events ========= */
    event RegistryUpdated(address indexed newRegistry);

    event Locked(address indexed owner, uint256 amount);
    event Unlocked(address indexed owner, uint256 amount);

    event MintProposed(address indexed investor, uint256 netAmount, bytes32 orderId);
    event BurnProposed(address indexed investor, uint256 shares, bytes32 orderId);

    event Subscription(address indexed investor, uint256 gross, uint256 net, bytes32 orderId);
    event RedemptionRequested(address indexed investor, uint256 shares, bytes32 orderId);
    event RedemptionPaid(address indexed investor, uint256 net, bytes32 orderId);

    event ForcedTransfer(address indexed from, address indexed to, uint256 amount);

    /**
     * @dev init comune richiamato dai token di tipo (Fund/Equity/Stable…)
     * @param referenceOracle_ oracle condiviso (ReferenceOracle)
     */
    function __SecurityTokenBase_init(
        string memory name_,
        string memory symbol_,
        address admin,
        address complianceOfficer,
        address initialRegistry,
        address referenceOracle_
    ) internal onlyInitializing {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __Pausable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, complianceOfficer);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(REGISTRY_ROLE, admin);

        registry = IComplianceRegistry(initialRegistry);
        emit RegistryUpdated(initialRegistry);

        maxDailyRedemptionBps = 0;
        exitFeeBps = 0;

        // reference oracle
        refOracle = IReferenceOracle(referenceOracle_);
        _refId = bytes32(uint256(uint160(address(this)))); // id automatico = address(proxy)
        emit ReferenceOracleSet(referenceOracle_, _refId);
    }

    /* ========= Reference getters ========= */

    function referenceId() external view returns (bytes32) {
        return _refId;
    }

    /**
     * @notice Valore “di riferimento” (non market price!)
     * @return value valore
     * @return lastUpdated timestamp (da oracle)
     * @return dec decimals dell’oracolo
     */
    function referenceData()
    external
    view
    returns (uint256 value, uint256 lastUpdated, uint8 dec) {
        (value, lastUpdated) = refOracle.getReference(_refId);
        dec = refOracle.decimals();
    }

    /**
     * @notice Cambia oracle di riferimento (se vuoi migrare oracle in futuro).
     *         refId resta lo stesso (address-based).
     */
    function setReferenceOracle(address newOracle) external onlyRole(REGISTRY_ROLE) {
        require(newOracle != address(0), "bad oracle");
        refOracle = IReferenceOracle(newOracle);
        emit ReferenceOracleSet(newOracle, _refId);
    }

    /* ========= Admin / Setup ========= */

    function setRegistry(address newRegistry) external onlyRole(REGISTRY_ROLE) {
        registry = IComplianceRegistry(newRegistry);
        emit RegistryUpdated(newRegistry);
    }

    function setLMT(uint256 _maxDailyRedemptionBps, uint256 _exitFeeBps)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        require(_maxDailyRedemptionBps <= 10000, "LMT: bps invalid");
        require(_exitFeeBps <= 10000, "LMT: bps invalid");
        maxDailyRedemptionBps = _maxDailyRedemptionBps;
        exitFeeBps = _exitFeeBps;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /* ========= Locking ========= */

    function lock(address owner, uint256 amount) external onlyRole(DEPOSITARY_ROLE) {
        uint256 bal = balanceOf(owner);
        uint256 lockedNow = _locked[owner];

        if (bal < lockedNow + amount) {
            revert(
                string(
                    abi.encodePacked(
                        "Lock exceeds balance: balance=",
                        Strings.toString(bal),
                        " locked=",
                        Strings.toString(lockedNow),
                        " requested=",
                        Strings.toString(amount)
                    )
                )
            );
        }

        _locked[owner] = lockedNow + amount;
        emit Locked(owner, amount);
    }

    function unlock(address owner, uint256 amount) external onlyRole(DEPOSITARY_ROLE) {
        uint256 lockedNow = _locked[owner];
        require(
            lockedNow >= amount,
            string(
                abi.encodePacked(
                    "Unlock exceeds locked amount: locked=",
                    Strings.toString(lockedNow),
                    " requested=",
                    Strings.toString(amount)
                )
            )
        );

        _locked[owner] = lockedNow - amount;
        emit Unlocked(owner, amount);
    }

    function lockedOf(address owner) external view returns (uint256) {
        return _locked[owner];
    }

    /* ========= Propose / Authorize ========= */

    function proposeMint(address investor, uint256 netAmount, bytes32 orderId)
        external
        onlyRole(PLATFORM_ROLE)
    {
        emit MintProposed(investor, netAmount, orderId);
    }

    function authorizeMint(address investor, uint256 amount, bytes32 orderId)
        external
        onlyRole(DEPOSITARY_ROLE)
    {
        require(investor != address(0), "Invalid investor address");
        require(amount > 0, "Mint amount must be > 0");
        require(orderId != bytes32(0), "Missing orderId");
        require(registry.isTransferAllowed(address(0), investor, amount), "Investor not compliant");

        _mint(investor, amount);
        emit Subscription(investor, amount, amount, orderId);
    }

    function proposeBurn(address investor, uint256 shares, bytes32 orderId)
        external
        onlyRole(PLATFORM_ROLE)
    {
        require(investor != address(0), "Invalid investor");
        require(shares > 0, "Invalid shares");
        uint256 bal = balanceOf(investor);
        uint256 lockedNow = _locked[investor];
        require(bal >= lockedNow + shares, "Insufficient unlocked balance");

        _locked[investor] = lockedNow + shares;
        emit Locked(investor, shares);

        emit BurnProposed(investor, shares, orderId);
        emit RedemptionRequested(investor, shares, orderId);
    }

    function authorizeBurn(address investor, uint256 shares, bytes32 orderId, uint256 netPaid)
        external
        onlyRole(DEPOSITARY_ROLE)
    {
        require(investor != address(0), "Invalid investor address");
        require(shares > 0, "Shares must be > 0");
        require(orderId != bytes32(0), "Missing orderId");
        require(balanceOf(investor) >= shares, "Insufficient balance");
        require(_locked[investor] >= shares, "Not enough locked shares for burn");

        _applyRedemptionGate(shares);

        _locked[investor] -= shares;
        emit Unlocked(investor, shares);

        _burn(investor, shares);
        emit RedemptionPaid(investor, netPaid, orderId);
    }

    function _applyRedemptionGate(uint256 shares) internal {
        if (maxDailyRedemptionBps == 0) return;
        uint256 day = block.timestamp / 1 days;
        uint256 limit = (totalSupply() * maxDailyRedemptionBps) / 10000;
        redeemedByDay[day] += shares;
        require(redeemedByDay[day] <= limit, "LMT: daily redemption gate");
    }

    /* ========= ERC20 hook + compliance ========= */

    function _update(address from, address to, uint256 value)
        internal
        virtual
        override(ERC20Upgradeable)
        whenNotPaused
    {
        if (from != address(0)) {
            uint256 balFrom = balanceOf(from);
            uint256 lockedFrom = _locked[from];
            require(balFrom >= lockedFrom, "Locked exceeds balance");
            uint256 spendable = balFrom - lockedFrom;
            require(value <= spendable, "Locked balance");
        }

        registry.enforceTransfer(from, to, value);
        super._update(from, to, value);
    }

    /* ========= Forced ops ========= */

    function forcedTransfer(address from, address to, uint256 amount)
        external
        onlyRole(FORCED_TRANSFER_ROLE)
    {
        // Reduce locked amount by the transferred value as much as possible,
        // then clamp to the remaining balance to avoid locked > balance situations.
        uint256 lockedBefore = _locked[from];
        if (lockedBefore != 0) {
            uint256 dec = lockedBefore < amount ? lockedBefore : amount;
            if (dec != 0) {
                _locked[from] = lockedBefore - dec;
                emit Unlocked(from, dec);
            }
        }

        _update(from, to, amount);

        uint256 newBal = balanceOf(from);
        uint256 lockedAfter = _locked[from];
        if (lockedAfter > newBal) {
            uint256 extra = lockedAfter - newBal;
            _locked[from] = newBal;
            emit Unlocked(from, extra);
        }

        emit ForcedTransfer(from, to, amount);
    }

    uint256[50] private __gap;
}

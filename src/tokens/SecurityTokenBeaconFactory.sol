// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

/// @notice Extensible factory that deploys BeaconProxy instances for multiple token families.
///         Families are identified by a `bytes32 typeId` (e.g. keccak256("FUND")) so new types
///         can be added after deployment (Option A).
/// @dev Beacons are owned by the factory, while the factory itself is controlled by `owner`.
contract SecurityTokenBeaconFactory{
    /// @notice type identifiers (optional convenience constants)
    bytes32 public constant TYPE_FUND   = keccak256("FUND");
    bytes32 public constant TYPE_EQUITY = keccak256("EQUITY");
    bytes32 public constant TYPE_STABLE = keccak256("STABLE");

    /// @notice typeId => beacon
    mapping(bytes32 => UpgradeableBeacon) public beaconOf;

    /// @notice Owner of the factory (typically a multisig / governance address).
    address public owner;

    event FactoryOwnerChanged(address indexed oldOwner, address indexed newOwner);

    event BeaconRegistered(bytes32 indexed typeId, address indexed beacon, address implementation, address beaconOwner);
    event BeaconImplementationUpgraded(bytes32 indexed typeId, address indexed newImplementation);
    event TokenProxyCreated(bytes32 indexed typeId, address indexed proxy, address indexed creator);

    error NotOwner();
    error TypeAlreadyRegistered(bytes32 typeId);
    error MissingBeacon(bytes32 typeId);
    error InvalidAddress();
    error InvalidImplementation();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address fundImpl,
        address equityImpl,
        address stableImpl,
        address factoryOwner
    ) {
        if (factoryOwner == address(0)) revert InvalidAddress();
        owner = factoryOwner;

        // Register initial families (Option A still allows adding more later)
        _registerType(TYPE_FUND, fundImpl);
        _registerType(TYPE_EQUITY, equityImpl);
        _registerType(TYPE_STABLE, stableImpl);
    }

    /// @notice Change factory owner (beacons remain owned by the factory).
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address old = owner;
        owner = newOwner;
        emit FactoryOwnerChanged(old, newOwner);
    }

    // ------------------------------------------------------------------------
    // Registration a new token
    // ------------------------------------------------------------------------

    /// @notice Register a new token family after deployment.
    /// @dev Deploys a new UpgradeableBeacon owned by this factory.
    function registerType(bytes32 typeId, address implementation) external onlyOwner returns (address beacon) {
        beacon = _registerType(typeId, implementation);
    }

    function _registerType(bytes32 typeId, address implementation) internal returns (address beacon) {
        if (typeId == bytes32(0)) revert InvalidAddress();
        if (implementation == address(0)) revert InvalidImplementation();
        if (address(beaconOf[typeId]) != address(0)) revert TypeAlreadyRegistered(typeId);

        // IMPORTANT: the beacon is owned by the factory, so upgrades via this factory succeed.
        UpgradeableBeacon b = new UpgradeableBeacon(implementation, address(this));
        beaconOf[typeId] = b;

        beacon = address(b);
        emit BeaconRegistered(typeId, beacon, implementation, address(this));
    }

    // ------------------------------------------------------------------------
    // Proxy creation
    // ------------------------------------------------------------------------

    /// @notice Create a new token proxy for the given family type.
    /// @param typeId Token family identifier (e.g. keccak256("FUND"))
    /// @param initData ABI-encoded initializer calldata for the chosen implementation
    function create(bytes32 typeId, bytes calldata initData) external returns (address proxy) {
        UpgradeableBeacon b = beaconOf[typeId];
        if (address(b) == address(0)) revert MissingBeacon(typeId);

        BeaconProxy p = new BeaconProxy(address(b), initData); // Deploy new proxy instance (token address)
        proxy = address(p);

        emit TokenProxyCreated(typeId, proxy, msg.sender);
    }

    // ------------------------------------------------------------------------
    // Upgrades
    // ------------------------------------------------------------------------

    /// @notice Upgrade the implementation for a given token family (beacon).
    /// @dev Restricted to the factory owner. Since the beacon is owned by the factory, this call will succeed.
    function upgradeBeaconTo(bytes32 typeId, address newImplementation) external onlyOwner {
        UpgradeableBeacon b = beaconOf[typeId];
        if (address(b) == address(0)) revert MissingBeacon(typeId);
        if (newImplementation == address(0)) revert InvalidImplementation();

        b.upgradeTo(newImplementation);
        emit BeaconImplementationUpgraded(typeId, newImplementation);
    }

    function currentImplementation(bytes32 typeId) external view returns (address) {
        UpgradeableBeacon b = beaconOf[typeId];
        if (address(b) == address(0)) revert MissingBeacon(typeId);
        return b.implementation();
    }

    function beaconAddress(bytes32 typeId) external view returns (address) {
        return address(beaconOf[typeId]);
    }
}

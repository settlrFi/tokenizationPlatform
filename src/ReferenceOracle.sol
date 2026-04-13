// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./tokens/interfaces/IReferenceOracle.sol";

contract ReferenceOracle is AccessControl, IReferenceOracle {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    struct Ref {
        uint128 value;
        uint64  lastUpdated;
    }

    mapping(bytes32 => Ref) private _refs;
    uint8 public immutable _decimals;

    event ReferenceUpdated(bytes32 indexed id, uint256 value, uint64 ts);

    constructor(uint8 decimals_, address admin) {
        _decimals = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function setPrice(bytes32 id, uint256 value, uint64 timestamp) external onlyRole(UPDATER_ROLE) {
        _set(id, value, timestamp);
    }

    function setReference(bytes32 id, uint256 value, uint64 timestamp) external onlyRole(UPDATER_ROLE) {
        _set(id, value, timestamp);
    }

    function _set(bytes32 id, uint256 value, uint64 timestamp) internal {
        require(value > 0 && value < type(uint128).max, "bad value");
        _refs[id] = Ref(uint128(value), timestamp);
        emit ReferenceUpdated(id, value, timestamp);
    }

    function getReference(bytes32 id) external view override returns (uint256, uint256) {
        Ref memory r = _refs[id];
        require(r.value != 0, "no reference");
        return (uint256(r.value), uint256(r.lastUpdated));
    }
}

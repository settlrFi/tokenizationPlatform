// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReferenceOracle {
    function getReference(bytes32 id) external view returns (uint256 value, uint256 lastUpdated);
    function decimals() external view returns (uint8);
}

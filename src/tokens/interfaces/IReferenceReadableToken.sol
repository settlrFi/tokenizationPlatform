// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReferenceReadableToken {
    function referenceData() external view returns (uint256 value, uint256 lastUpdated, uint8 decimals);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title INavOracle
 * @notice Oracolo on-chain del NAV (prezzo quota) con controlli di staleness e jump.
 */
interface INavOracle {
    function currentNav() external view returns (uint256 nav, uint256 updatedAt, uint256 adjBps);

    function setNav(uint256 nav, bytes32 offchainHash) external;

    function setConfig(uint256 maxStaleness, uint256 maxJumpBps) external;

    function setAdjBps(uint256 adjBps) external;

    /* ========= Events ========= */
    event NavSet(uint256 nav, uint256 timestamp, bytes32 offchainHash);
    event NavAdjSet(uint256 adjBps);
    event ConfigSet(uint256 maxStaleness, uint256 maxJumpBps);
}

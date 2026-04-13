// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {INavOracle} from "./interfaces/INavOracle.sol";

/**
 * @title NavOracle
 * @notice Mantiene il NAV (1e18 = 1.0) e un fattore di aggiustamento (es. swing pricing) in bps.
 *         Applica limiti su "salto" massimo tra due NAV e staleness window configurabile.
 */
contract NavOracle is INavOracle, AccessControl {
    bytes32 public constant NAV_SETTER_ROLE = keccak256("NAV_SETTER_ROLE");
    bytes32 public constant CONFIG_ROLE     = keccak256("CONFIG_ROLE");

    uint256 private _nav;           // 18 decimali
    uint256 private _updatedAt;     // timestamp ultimo NAV
    uint256 private _adjBps;        // aggiustamento in basis points (può essere 0..10000, positivo o “firmato” via convenzione)

    uint256 public maxStaleness;    // p.es. 48 ore
    uint256 public maxJumpBps;      // salto max consentito tra due NAV (in bps)

    constructor(address admin, address navSetter, uint256 _maxStaleness, uint256 _maxJumpBps) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(NAV_SETTER_ROLE, navSetter);
        _grantRole(CONFIG_ROLE, admin);
        maxStaleness = _maxStaleness;
        maxJumpBps   = _maxJumpBps;
    }

    function currentNav() external view override returns (uint256 nav, uint256 updatedAt, uint256 adjBps) {
        return (_nav, _updatedAt, _adjBps);
    }

    function setNav(uint256 nav, bytes32 offchainHash) external override onlyRole(NAV_SETTER_ROLE) {
        require(nav > 0, "NAV: zero");
        if (_nav != 0 && maxJumpBps > 0) {
            // |nav - _nav| / _nav <= maxJumpBps
            uint256 diff = nav > _nav ? nav - _nav : _nav - nav;
            require(diff * 10000 <= _nav * maxJumpBps, "NAV: jump too large");
        }
        _nav = nav;
        _updatedAt = block.timestamp;
        emit NavSet(nav, _updatedAt, offchainHash);
    }

    function setConfig(uint256 _maxStaleness, uint256 _maxJump) external override onlyRole(CONFIG_ROLE) {
        maxStaleness = _maxStaleness;
        maxJumpBps   = _maxJump;
        emit ConfigSet(_maxStaleness, _maxJump);
    }

    /// @notice Imposta un fattore di aggiustamento (es. swing pricing) in bps (es. 25 = +0.25%).
    function setAdjBps(uint256 adjBps) external override onlyRole(NAV_SETTER_ROLE) {
        require(adjBps <= 2000, "NAV: adj too large"); // ~20% hard cap prudenziale
        _adjBps = adjBps;
        emit NavAdjSet(adjBps);
    }

    /// @notice Per aggiornare il NAV usando setAdjBps
    function getEffectiveNav() public view returns (uint256 navAdj) {
    navAdj = (_nav * (10000 + _adjBps)) / 10000;
    }


}

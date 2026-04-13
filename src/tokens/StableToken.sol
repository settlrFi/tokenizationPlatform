// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SecurityTokenBase} from "./SecurityTokenBase.sol";

contract StableToken is SecurityTokenBase {
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    string public pegDescription;
    event PegUpdated(string peg);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initializeStable(
        string memory name_,
        string memory symbol_,
        address admin,
        address complianceOfficer,
        address initialRegistry,
        address referenceOracle_,
        address treasury,
        string memory peg_
    ) external initializer {
        __SecurityTokenBase_init(
            name_, symbol_, admin, complianceOfficer, initialRegistry, referenceOracle_
        );
        _grantRole(TREASURY_ROLE, treasury);
        pegDescription = peg_;
        emit PegUpdated(peg_);
    }

    function setPeg(string calldata peg_) external onlyRole(TREASURY_ROLE) {
        pegDescription = peg_;
        emit PegUpdated(peg_);
    }

      /**
     * @notice Peg/reference della stable dal ReferenceOracle.
     *         Non è necessariamente il prezzo di mercato sul DEX.
     */
    function pegReferenceData()
        external
        view
        returns (uint256 value, uint256 lastUpdated, uint8 decimals)
    {
        return this.referenceData();
    }

    function pegReference() external view returns (uint256 value) {
        (value,,) = this.referenceData();
    }

    uint256[50] private __gapSt;
}

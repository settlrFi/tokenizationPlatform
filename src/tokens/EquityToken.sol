// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SecurityTokenBase} from "./SecurityTokenBase.sol";

contract EquityToken is SecurityTokenBase {
    bytes32 public constant CORP_ACTION_ROLE = keccak256("CORP_ACTION_ROLE");

    struct EquityMetadata {
        string issuerName;
        string isin;
        string shareClass;
        string termsUri;
    }
    EquityMetadata public equityMeta;

    uint256 public lastSplitRatioBps;

    event EquityMetadataUpdated(EquityMetadata meta);
    event SplitApplied(uint256 ratioBps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initializeEquity(
        string memory name_,
        string memory symbol_,
        address admin,
        address complianceOfficer,
        address initialRegistry,
        address referenceOracle_,
        address corpActionOperator,
        EquityMetadata calldata meta_
    ) external initializer {
        __SecurityTokenBase_init(
            name_, symbol_, admin, complianceOfficer, initialRegistry, referenceOracle_
        );
        _grantRole(CORP_ACTION_ROLE, corpActionOperator);
        equityMeta = meta_;
        emit EquityMetadataUpdated(meta_);
    }

    function setEquityMetadata(EquityMetadata calldata meta_) external onlyRole(REGISTRY_ROLE) {
        equityMeta = meta_;
        emit EquityMetadataUpdated(meta_);
    }

    function applySplit(uint256 ratioBps) external onlyRole(CORP_ACTION_ROLE) {
        require(ratioBps > 0 && ratioBps <= 50000, "bad split");
        lastSplitRatioBps = ratioBps;
        emit SplitApplied(ratioBps);
    }

   /**
     * @notice Reference value dell’equity (issuer-provided) dal ReferenceOracle.
     *         Non è il prezzo di mercato.
   
    function referencePriceData()
        external
        view
        returns (uint256 value, uint256 lastUpdated, uint8 decimals)
    {
        return this.referenceData();
    }


    function referencePrice() external view returns (uint256 value) {
        (value,,) = this.referenceData();
    }
  */
    uint256[50] private __gapEq;
}

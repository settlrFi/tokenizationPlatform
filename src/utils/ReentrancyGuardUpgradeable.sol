// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract ReentrancyGuardUpgradeable is Initializable {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    struct ReentrancyGuardStorage {
        uint256 status;
    }

    // keccak256(abi.encode(uint256(keccak256("tokenization.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE_LOCATION =
        0xcc3fbf831f2f85e3eeeb4e9b7cb8c7cd4c52f538b3fe5edce95fa47e322ebc00;

    function _getReentrancyGuardStorage() private pure returns (ReentrancyGuardStorage storage $) {
        assembly {
            $.slot := REENTRANCY_GUARD_STORAGE_LOCATION
        }
    }

    function __ReentrancyGuard_init() internal onlyInitializing {
        __ReentrancyGuard_init_unchained();
    }

    function __ReentrancyGuard_init_unchained() internal onlyInitializing {
        _getReentrancyGuardStorage().status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        ReentrancyGuardStorage storage $ = _getReentrancyGuardStorage();
        require($.status != _ENTERED, "ReentrancyGuard: reentrant call");
        $.status = _ENTERED;
        _;
        $.status = _NOT_ENTERED;
    }
}

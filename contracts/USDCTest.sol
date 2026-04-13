// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDCTest is ERC20 {
    constructor() ERC20("USDCTest", "USDCt") {
        _mint(msg.sender, 1_000_000e6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

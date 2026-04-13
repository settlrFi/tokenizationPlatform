// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ProxyWallet} from "./ProxyWallet.sol";

/// @notice Factory deterministica: 1 wallet per owner, address prevedibile via CREATE2 (Clones).
contract ProxyWalletFactory {
    using Clones for address;

    address public immutable implementation;

    event WalletCreated(address indexed owner, address wallet);

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function _salt(address owner) internal pure returns (bytes32) {
        // determinismo: 1 wallet per EOA (puoi cambiare schema se vuoi più wallet per owner)
        return keccak256(abi.encodePacked(owner));
    }

    function predictWallet(address owner) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(owner), address(this));
    }

    function getWallet(address owner) external view returns (address wallet, bool deployed) {
        wallet = predictWallet(owner);
        deployed = wallet.code.length > 0;
    }

    function createWallet(address owner) public returns (address wallet) {
        wallet = Clones.cloneDeterministic(implementation, _salt(owner));
        ProxyWallet(payable(wallet)).initialize(owner);
        emit WalletCreated(owner, wallet);
    }

    function getOrCreateWallet(address owner) external returns (address wallet) {
        wallet = predictWallet(owner);
        if (wallet.code.length == 0) {
            wallet = createWallet(owner);
        }
    }
}

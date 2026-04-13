// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IProxyWallet {
    struct Call {
        address to;
        uint256 value;
        bytes data;
        uint8 operation; // 0=call, 1=delegatecall
    }

    struct Execute {
        Call call;
        uint256 nonce;
        uint256 deadline;
        address executor;
        address feeToken;
        uint256 feeAmount;
        address feeRecipient;
    }

    function executeWithSig(Execute calldata req, bytes calldata signature)
        external
        payable
        returns (bytes memory);
}

contract RelayBundler {
    using SafeERC20 for IERC20;

    error BadFeeToken();
    error BadFeeRecipient();
    error PullTooSmall();

    /// @notice 1) permit EIP-2612 (gasless) 2) pull tokens from EOA -> ProxyWallet 3) execute meta-tx from ProxyWallet
    /// @dev relayer chiama questa funzione e paga il gas in native. L'utente firma off-chain sia permit che execute.
    function permitPullToWalletAndExecute(
        address token,
        address owner,
        address proxyWallet,
        uint256 pullAmount,        // deve coprire amount + fee
        uint256 permitDeadline,
        uint8 v, bytes32 r, bytes32 s,
        IProxyWallet.Execute calldata exec,
        bytes calldata execSig
    ) external returns (bytes memory result) {
        // Hardening: fee token deve essere lo stesso token che stiamo pullando
        if (exec.feeToken != token) revert BadFeeToken();
        // Hardening: feeRecipient tipicamente è il relayer (msg.sender)
        if (exec.feeRecipient != msg.sender) revert BadFeeRecipient();
        // Hardening: deve esserci abbastanza pulled amount per coprire fee (e l'azione)
        if (pullAmount < exec.feeAmount) revert PullTooSmall();

        // 1) permit: abilita questo bundler a spendere pullAmount dal wallet EOA owner
        IERC20Permit(token).permit(owner, address(this), pullAmount, permitDeadline, v, r, s);

        // 2) pull: trasferisce i token dall'EOA al ProxyWallet
        IERC20(token).safeTransferFrom(owner, proxyWallet, pullAmount);

        // 3) execute: ProxyWallet fa la call applicativa e poi paga fee in token al relayer
        result = IProxyWallet(proxyWallet).executeWithSig(exec, execSig);
    }
}

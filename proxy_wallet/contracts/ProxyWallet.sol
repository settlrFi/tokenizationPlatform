// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Smart contract wallet 1-of-1: owner firma off-chain richieste EIP-712, relayer esegue on-chain.
contract ProxyWallet is Initializable, EIP712Upgradeable, IERC1155Receiver {
    using SafeERC20 for IERC20;

    // -------------------------
    // Errors (gas-cheap)
    // -------------------------
    error ZeroOwner();
    error Unauthorized();
    error InvalidNonce();
    error Expired();
    error ExecutorMismatch();
    error InvalidSignature();
    error InvalidOperation();
    error FeeRecipientRequired();
    error CallsHashMismatch();

    // -------------------------
    // Types
    // -------------------------
    struct Call {
        address to;
        uint256 value;
        bytes data;
        uint8 operation; // 0 = call, 1 = delegatecall
    }

    struct Execute {
        Call call;
        uint256 nonce;
        uint256 deadline;     // 0 = no deadline
        address executor;     // 0 = chiunque può submit, altrimenti deve essere msg.sender
        address feeToken;     // 0 = native, altrimenti ERC20
        uint256 feeAmount;    // 0 = nessuna fee
        address feeRecipient; // richiesto se feeAmount > 0
    }

    struct ExecuteBatch {
        bytes32 callsHash;    // keccak256(concat(hash(Call_i)))
        uint256 nonce;
        uint256 deadline;     // 0 = no deadline
        address executor;     // 0 = chiunque può submit, altrimenti deve essere msg.sender
        address feeToken;     // 0 = native, altrimenti ERC20
        uint256 feeAmount;    // 0 = nessuna fee
        address feeRecipient; // richiesto se feeAmount > 0
    }

    // -------------------------
    // Storage
    // -------------------------
    address public owner;
    uint256 public nonce; // replay-protection per meta-exec

    // -------------------------
    // EIP-712 typehashes
    // -------------------------
    bytes32 private constant CALL_TYPEHASH =
        keccak256("Call(address to,uint256 value,bytes data,uint8 operation)");

    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256(
            "Execute(Call call,uint256 nonce,uint256 deadline,address executor,address feeToken,uint256 feeAmount,address feeRecipient)"
            "Call(address to,uint256 value,bytes data,uint8 operation)"
        );

    bytes32 private constant EXECUTEBATCH_TYPEHASH =
        keccak256(
            "ExecuteBatch(bytes32 callsHash,uint256 nonce,uint256 deadline,address executor,address feeToken,uint256 feeAmount,address feeRecipient)"
        );

    // -------------------------
    // Events (minimali)
    // -------------------------
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event Executed(bytes32 indexed digest, address indexed to, uint256 value, uint8 operation);
    event BatchExecuted(bytes32 indexed digest, uint256 calls);

    // -------------------------
    // Constructor (solo impl): blocca initialize su implementation
    // -------------------------
    constructor() {
        _disableInitializers();
    }

    // -------------------------
    // Init (per clone)
    // -------------------------
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroOwner();
        owner = owner_;
        __EIP712_init("ProxyWallet", "1");
    }

    // -------------------------
    // Admin (owner on-chain)
    // -------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroOwner();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Permette all'owner di invalidare richieste firmate non ancora eseguite (bump nonce).
    function bumpNonce(uint256 newNonce) external onlyOwner {
        if (newNonce <= nonce) revert InvalidNonce();
        nonce = newNonce;
    }

    // -------------------------
    // Direct execution (owner paga gas)
    // -------------------------
    function execute(Call calldata c) external payable onlyOwner returns (bytes memory result) {
        result = _performCall(c);
    }

    function executeBatch(Call[] calldata calls) external payable onlyOwner returns (bytes[] memory results) {
        results = _performBatch(calls);
    }

    // -------------------------
    // Meta execution (relayer paga gas)
    // -------------------------
    function executeWithSig(Execute calldata req, bytes calldata signature)
        external
        payable
        returns (bytes memory result)
    {
        _precheck(req.deadline, req.executor);

        uint256 current = nonce;
        if (req.nonce != current) revert InvalidNonce();

        bytes32 digest = _hashTypedDataV4(_hashExecute(req));

        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();

        // effects
        nonce = current + 1;

        // interaction
        result = _performCall(req.call);

        _payFee(req.feeToken, req.feeAmount, req.feeRecipient);

        emit Executed(digest, req.call.to, req.call.value, req.call.operation);
    }

    function executeBatchWithSig(
        Call[] calldata calls,
        ExecuteBatch calldata req,
        bytes calldata signature
    ) external payable returns (bytes[] memory results) {
        _precheck(req.deadline, req.executor);

        uint256 current = nonce;
        if (req.nonce != current) revert InvalidNonce();

        bytes32 computedCallsHash = _hashCalls(calls);
        if (computedCallsHash != req.callsHash) revert CallsHashMismatch();

        bytes32 digest = _hashTypedDataV4(_hashExecuteBatch(req));

        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidSignature();

        // effects
        nonce = current + 1;

        // interactions
        results = _performBatch(calls);

        _payFee(req.feeToken, req.feeAmount, req.feeRecipient);

        emit BatchExecuted(digest, calls.length);
    }

    // -------------------------
    // Internal helpers
    // -------------------------
    function _precheck(uint256 deadline, address executor) internal view {
        if (deadline != 0 && block.timestamp > deadline) revert Expired();
        if (executor != address(0) && executor != msg.sender) revert ExecutorMismatch();
    }

    function _hashCall(Call calldata c) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            CALL_TYPEHASH,
            c.to,
            c.value,
            keccak256(c.data),
            c.operation
        ));
    }

    function _hashExecute(Execute calldata r) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            EXECUTE_TYPEHASH,
            _hashCall(r.call),
            r.nonce,
            r.deadline,
            r.executor,
            r.feeToken,
            r.feeAmount,
            r.feeRecipient
        ));
    }

    function _hashExecuteBatch(ExecuteBatch calldata r) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            EXECUTEBATCH_TYPEHASH,
            r.callsHash,
            r.nonce,
            r.deadline,
            r.executor,
            r.feeToken,
            r.feeAmount,
            r.feeRecipient
        ));
    }

    /// @notice callsHash = keccak256(concat(hash(Call_i))) per batch signing
    function _hashCalls(Call[] calldata calls) internal pure returns (bytes32) {
        uint256 len = calls.length;
        bytes memory packed = new bytes(len * 32);

        for (uint256 i = 0; i < len; ) {
            bytes32 h = _hashCall(calls[i]);
            assembly {
                mstore(add(packed, add(32, mul(i, 32))), h)
            }
            unchecked { ++i; }
        }
        return keccak256(packed);
    }

    function _performBatch(Call[] calldata calls) internal returns (bytes[] memory results) {
        uint256 len = calls.length;
        results = new bytes[](len);
        for (uint256 i = 0; i < len; ) {
            results[i] = _performCall(calls[i]);
            unchecked { ++i; }
        }
    }

    function _performCall(Call calldata c) internal returns (bytes memory result) {
        bool success;

        if (c.operation == 0) {
            (success, result) = c.to.call{value: c.value}(c.data);
        } else if (c.operation == 1) {
            // delegatecall non può trasferire value in modo sensato: blocchiamo value > 0
            if (c.value != 0) revert InvalidOperation();
            (success, result) = c.to.delegatecall(c.data);
        } else {
            revert InvalidOperation();
        }

        if (!success) _bubbleRevert(result);
    }

    function _payFee(address feeToken, uint256 feeAmount, address feeRecipient) internal {
        if (feeAmount == 0) return;
        if (feeRecipient == address(0)) revert FeeRecipientRequired();

        if (feeToken == address(0)) {
            Address.sendValue(payable(feeRecipient), feeAmount);
        } else {
            IERC20(feeToken).safeTransfer(feeRecipient, feeAmount);
        }
    }

    function _bubbleRevert(bytes memory revertData) internal pure {
        if (revertData.length > 0) {
            assembly {
                revert(add(revertData, 32), mload(revertData))
            }
        }
        revert("CALL_FAILED");
    }

    // -------------------------
    // Receive native (ETH/MATIC/etc.)
    // -------------------------
    receive() external payable {}

    // -------------------------
    // ERC-1155 receiver (posizioni tipo Polymarket)
    // -------------------------
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}

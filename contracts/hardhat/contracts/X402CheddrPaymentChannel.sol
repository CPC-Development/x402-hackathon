// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract X402CheddrPaymentChannel is EIP712 {
    using ECDSA for bytes32;

    struct Channel {
        address owner;
        uint256 balance;
        uint256 expiryTime;
        uint256 sequenceNumber;
        mapping(address => uint256) balances;
        address[] recipients;
    }

    struct BatchClosure {
        bytes32 channelId;
        uint256 sequenceNumber;
        uint256 timestamp;
        address[] recipients;
        uint256[] amounts;
        bytes userSignature;
    }

    IERC20 public immutable token;
    address public immutable sequencer;

    mapping(bytes32 => Channel) public channels;
    mapping(address => bytes32[]) public userChannels;

    event FundsBlocked(address indexed owner, uint256 amount, bytes32 indexed channelId);
    event ChannelClosed(address indexed owner, bytes32 indexed channelId);
    event FundsReturnedToOwner(address indexed owner, uint256 amount);
    event IntermediateStatePublished(bytes32 indexed channelId, uint256 sequenceNumber, address indexed publisher);

    constructor(address tokenAddress, address sequencerAddress) EIP712("X402CheddrPaymentChannel", "1") {
        require(tokenAddress != address(0), "Invalid token");
        require(sequencerAddress != address(0), "Invalid sequencer");
        token = IERC20(tokenAddress);
        sequencer = sequencerAddress;
    }

    function openChannel(
        uint256 amount,
        uint256 expiryTime,
        uint256 signatureTimestamp,
        bytes calldata userSignature
    ) external returns (bytes32 channelId) {
        address owner = msg.sender;
        require(!_isContract(owner), "Only EOA can open channels");
        require(amount > 0, "Amount must be greater than zero");
        require(expiryTime > block.timestamp, "Expiry time must be in the future");
        require(expiryTime <= block.timestamp + 365 days, "Expiry time must be within 1 year");

        channelId = getChannelId(owner, expiryTime, amount);
        require(channels[channelId].expiryTime == 0, "Channel already exists");

        _verifySignatureTimestampValue(expiryTime, signatureTimestamp);
        require(userSignature.length > 0, "Missing user signature");
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        require(
            _isSignatureValidForSigner(
                owner,
                channelId,
                0,
                signatureTimestamp,
                recipients,
                amounts,
                userSignature
            ),
            "Invalid user signature"
        );

        require(token.transferFrom(owner, address(this), amount), "Transfer failed");

        Channel storage channel = channels[channelId];
        channel.owner = owner;
        channel.balance = amount;
        channel.expiryTime = expiryTime;

        userChannels[owner].push(channelId);

        emit FundsBlocked(owner, amount, channelId);
    }

    function finalCloseBySequencer(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes calldata userSignature
    ) external {
        require(msg.sender == sequencer, "Only sequencer can close the channel");
        _validateAndCloseChannel(channelId, sequenceNumber, timestamp, recipients, amounts, userSignature);
    }

    function finalCloseBySequencerBatch(BatchClosure[] calldata batch) external {
        require(msg.sender == sequencer, "Only sequencer can close the channel");
        for (uint256 i = 0; i < batch.length; i++) {
            BatchClosure memory closure = batch[i];
            _validateAndCloseChannel(
                closure.channelId,
                closure.sequenceNumber,
                closure.timestamp,
                closure.recipients,
                closure.amounts,
                closure.userSignature
            );
        }
    }

    function publishIntermediateChannelState(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes calldata userSignature,
        bytes calldata sequencerSignature
    ) external {
        require(channelId != bytes32(0), "Invalid channel ID");
        require(channels[channelId].expiryTime != 0, "Channel does not exist");
        require(block.timestamp <= channels[channelId].expiryTime, "Channel has expired");
        require(recipients.length == amounts.length, "recipients and amounts must match in size");
        require(sequenceNumber > channels[channelId].sequenceNumber, "Sequence number too low");

        _verifySignatureTimestamp(channelId, timestamp);

        require(
            _isSignatureValid(channelId, sequenceNumber, timestamp, recipients, amounts, userSignature, true),
            "Invalid user signature"
        );
        require(
            _isSignatureValid(channelId, sequenceNumber, timestamp, recipients, amounts, sequencerSignature, false),
            "Invalid sequencer signature"
        );

        _updateChannelBalances(channelId, sequenceNumber, recipients, amounts);
        emit IntermediateStatePublished(channelId, sequenceNumber, msg.sender);
    }

    function closeAfterExpiryByAnyone(bytes32 channelId) external {
        require(channelId != bytes32(0), "Invalid channel ID");
        require(channels[channelId].expiryTime != 0, "Channel does not exist");
        Channel storage channel = channels[channelId];
        require(block.timestamp > channel.expiryTime, "Channel has not expired yet");

        uint256[] memory amounts = _convertRecipientAmounts(channel);
        _distributeChannelFunds(channel.recipients, amounts, channel);

        if (channel.balance > 0) {
            token.transfer(channel.owner, channel.balance);
            emit FundsReturnedToOwner(channel.owner, channel.balance);
            channel.balance = 0;
        }

        _closeAndCleanupChannel(channelId);
    }

    function validateUserSignature(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes calldata userSignature
    ) external view returns (bool) {
        _verifySignatureTimestamp(channelId, timestamp);
        return _isSignatureValid(channelId, sequenceNumber, timestamp, recipients, amounts, userSignature, true);
    }

    function getRecipientBalance(bytes32 channelId, address recipient) external view returns (uint256) {
        return channels[channelId].balances[recipient];
    }

    function getNumberOfRecipients(bytes32 channelId) external view returns (uint256) {
        return channels[channelId].recipients.length;
    }

    function getChannelId(address owner, uint256 expiryTime, uint256 amount) public view returns (bytes32) {
        return keccak256(abi.encodePacked(owner, expiryTime, amount, _domainSeparatorV4()));
    }

    function getUserChannelLength(address owner) external view returns (uint256) {
        return userChannels[owner].length;
    }

    function _validateAndCloseChannel(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] memory recipients,
        uint256[] memory amounts,
        bytes memory userSignature
    ) internal {
        require(channelId != bytes32(0), "Invalid channel ID");
        require(channels[channelId].expiryTime != 0, "Channel does not exist");
        require(recipients.length == amounts.length, "recipients and amounts must match in size");

        _verifySignatureTimestamp(channelId, timestamp);

        require(
            _isSignatureValid(channelId, sequenceNumber, timestamp, recipients, amounts, userSignature, true),
            "Invalid user signature"
        );

        Channel storage channel = channels[channelId];
        require(sequenceNumber >= channel.sequenceNumber, "Old sequence number provided");

        _distributeChannelFunds(recipients, amounts, channel);

        if (channel.balance > 0) {
            token.transfer(channel.owner, channel.balance);
            emit FundsReturnedToOwner(channel.owner, channel.balance);
            channel.balance = 0;
        }

        _closeAndCleanupChannel(channelId);
    }

    function _updateChannelBalances(
        bytes32 channelId,
        uint256 sequenceNumber,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) internal {
        Channel storage channel = channels[channelId];
        channel.sequenceNumber = sequenceNumber;
        for (uint256 i = 0; i < recipients.length; i++) {
            channel.balances[recipients[i]] = amounts[i];
        }
        channel.recipients = recipients;
    }

    function _convertRecipientAmounts(Channel storage channel) internal view returns (uint256[] memory amounts) {
        amounts = new uint256[](channel.recipients.length);
        for (uint256 i = 0; i < channel.recipients.length; i++) {
            amounts[i] = channel.balances[channel.recipients[i]];
        }
        return amounts;
    }

    function _distributeChannelFunds(
        address[] memory recipients,
        uint256[] memory amounts,
        Channel storage channel
    ) internal {
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(amounts[i] <= channel.balance, "Amount exceeds available balance");
            totalAmount += amounts[i];
        }
        require(totalAmount <= channel.balance, "Total exceeds channel balance");

        for (uint256 i = 0; i < recipients.length; i++) {
            token.transfer(recipients[i], amounts[i]);
            channel.balance -= amounts[i];
        }
    }

    function _isSignatureValid(
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] memory recipients,
        uint256[] memory amounts,
        bytes memory signature,
        bool isUserSignature
    ) internal view returns (bool) {
        address expectedSigner = isUserSignature ? channels[channelId].owner : sequencer;
        return _isSignatureValidForSigner(
            expectedSigner,
            channelId,
            sequenceNumber,
            timestamp,
            recipients,
            amounts,
            signature
        );
    }

    function _verifySignatureTimestamp(bytes32 channelId, uint256 timestamp) internal view {
        uint256 expiryTime = channels[channelId].expiryTime;
        _verifySignatureTimestampValue(expiryTime, timestamp);
    }

    function _verifySignatureTimestampValue(uint256 expiryTime, uint256 timestamp) internal view {
        require(block.timestamp >= timestamp - 15 minutes, "Timestamp of signature from the future");
        require(expiryTime >= timestamp, "Signature after channel expiry");
    }

    function _isSignatureValidForSigner(
        address expectedSigner,
        bytes32 channelId,
        uint256 sequenceNumber,
        uint256 timestamp,
        address[] memory recipients,
        uint256[] memory amounts,
        bytes memory signature
    ) internal view returns (bool) {
        require(expectedSigner != address(0), "Invalid signer");
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ChannelData(bytes32 channelId,uint256 sequenceNumber,uint256 timestamp,address[] recipients,uint256[] amounts)"
                ),
                channelId,
                sequenceNumber,
                timestamp,
                keccak256(abi.encodePacked(recipients)),
                keccak256(abi.encodePacked(amounts))
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature) == expectedSigner;
    }

    function _closeAndCleanupChannel(bytes32 channelId) internal {
        Channel storage channel = channels[channelId];
        emit ChannelClosed(channel.owner, channelId);
        _removeChannelFromUser(channel.owner, channelId);
        delete channels[channelId];
    }

    function _removeChannelFromUser(address owner, bytes32 channelId) private {
        bytes32[] storage channelList = userChannels[owner];
        for (uint256 i = 0; i < channelList.length; i++) {
            if (channelList[i] == channelId) {
                channelList[i] = channelList[channelList.length - 1];
                channelList.pop();
                break;
            }
        }
    }

    function _isContract(address account) private view returns (bool) {
        return account.code.length > 0;
    }
}

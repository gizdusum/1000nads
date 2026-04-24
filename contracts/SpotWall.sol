// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Base64 {
    string internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";

        string memory table = TABLE;
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        string memory result = new string(encodedLen + 32);

        assembly {
            mstore(result, encodedLen)

            let tablePtr := add(table, 1)
            let dataPtr := data
            let endPtr := add(dataPtr, mload(data))
            let resultPtr := add(result, 32)

            for {} lt(dataPtr, endPtr) {}
            {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)

                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }

            switch mod(mload(data), 3)
            case 1 {
                mstore(sub(resultPtr, 2), shl(240, 0x3d3d))
            }
            case 2 {
                mstore(sub(resultPtr, 1), shl(248, 0x3d))
            }
        }

        return result;
    }
}

contract SpotWall {
    uint256 public constant TOTAL_SLOTS = 1000;
    uint256 public constant SLOT_PRICE = 1 ether;

    string public constant NAME = "1000nads";
    string public constant SYMBOL = "NADS";
    string public constant DESCRIPTION =
        "1000nads is a finite Monad-native wall. One wallet. One slot. One permanent place on the page.";

    address public owner;

    struct Spot {
        address owner;
        string imageUri;
        string note;
        bool isPermanent;
        uint256 mintedAt;
    }

    mapping(uint256 => Spot) public spotData;
    mapping(address => uint256) public walletToSlot;

    event SpotMinted(uint256 indexed slotId, address indexed owner, string imageUri, string note, bool isPermanent);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function mintSpot(uint256 slotId, string calldata imageUri, string calldata note, bool isPermanent) external payable {
        require(slotId < TOTAL_SLOTS, "invalid slot");
        require(msg.value == SLOT_PRICE, "wrong price");
        require(bytes(imageUri).length > 0, "empty uri");
        require(bytes(imageUri).length <= 180000, "image too large");
        require(bytes(note).length <= 96, "note too long");
        require(_isSafeNote(note), "unsafe note");
        require(walletToSlot[msg.sender] == 0 && !_ownsZero(msg.sender), "wallet already owns slot");
        require(spotData[slotId].owner == address(0), "slot already claimed");

        spotData[slotId] = Spot({
            owner: msg.sender,
            imageUri: imageUri,
            note: note,
            isPermanent: isPermanent,
            mintedAt: block.timestamp
        });

        walletToSlot[msg.sender] = slotId + 1;
        emit SpotMinted(slotId, msg.sender, imageUri, note, isPermanent);
    }

    function ownerOfSlot(uint256 slotId) external view returns (address) {
        return spotData[slotId].owner;
    }

    function tokenURI(uint256 slotId) public view returns (string memory) {
        Spot memory spot = spotData[slotId];
        require(spot.owner != address(0), "spot not minted");

        string memory permanence = spot.isPermanent ? "fully-onchain" : "external-image";
        string memory payload = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name":"1000nads Slot #',
                        _toString(slotId + 1),
                        '","description":"',
                        DESCRIPTION,
                        '","image":"',
                        spot.imageUri,
                        '","attributes":[{"trait_type":"slot","value":"',
                        _toString(slotId + 1),
                        '"},{"trait_type":"permanence","value":"',
                        permanence,
                        '"},{"trait_type":"owner","value":"',
                        _toHexString(spot.owner),
                        '"},{"trait_type":"note","value":"',
                        spot.note,
                        '"}]}'
                    )
                )
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", payload));
    }

    function withdraw(address payable to) external onlyOwner {
        to.transfer(address(this).balance);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _ownsZero(address wallet) internal view returns (bool) {
        return spotData[0].owner == wallet;
    }

    function _onlyOwner() internal view {
        require(msg.sender == owner, "not owner");
    }

    function _isSafeNote(string calldata note) internal pure returns (bool) {
        bytes calldata data = bytes(note);
        for (uint256 i = 0; i < data.length; i++) {
            bytes1 char = data[i];
            if (char == '"' || char == "\\" || uint8(char) < 0x20) {
                return false;
            }
        }
        return true;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            // forge-lint: disable-next-line(unsafe-typecast)
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }

        return string(buffer);
    }

    function _toHexString(address account) internal pure returns (string memory) {
        bytes20 value = bytes20(account);
        bytes16 symbols = 0x30313233343536373839616263646566;
        bytes memory buffer = new bytes(42);
        buffer[0] = "0";
        buffer[1] = "x";

        for (uint256 i = 0; i < 20; i++) {
            buffer[2 + i * 2] = bytes1(symbols[uint8(value[i] >> 4)]);
            buffer[3 + i * 2] = bytes1(symbols[uint8(value[i] & 0x0f)]);
        }

        return string(buffer);
    }
}

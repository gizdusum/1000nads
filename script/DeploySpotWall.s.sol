// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SpotWall} from "../contracts/SpotWall.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeploySpotWall {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (SpotWall wall) {
        uint256 privateKey = VM.envUint("MONAD_DEPLOYER_PRIVATE_KEY");

        VM.startBroadcast(privateKey);
        wall = new SpotWall();
        VM.stopBroadcast();
    }
}

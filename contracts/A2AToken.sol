// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title A2A Token
/// @notice Native coordination token for the A2A402 agent economy.
/// @dev Fixed supply. No hidden mint function. Initial supply is minted once to the deployer/owner.
contract A2AToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    constructor(address initialOwner)
        ERC20("A2A", "A2A")
        Ownable(initialOwner)
    {
        _mint(initialOwner, MAX_SUPPLY);
    }
}

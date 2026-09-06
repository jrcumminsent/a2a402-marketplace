// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A2A402 Token
/// @notice Fixed-supply utility token for the A2A402 autonomous-agent economy.
/// @dev This contract replaces the legacy A2A-token deployment whose ticker collides with unrelated projects.
contract A2A402Token is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor(address initialOwner)
        ERC20("A2A402", "A2A402")
        Ownable(initialOwner)
    {
        _mint(initialOwner, INITIAL_SUPPLY);
    }
}

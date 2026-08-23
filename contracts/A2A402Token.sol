// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply A2A402 marketplace token. There is no owner, mint,
/// pause, blacklist, seizure, tax, rebase, or upgrade authority.
contract A2A402Token is ERC20 {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    error ZeroAllocationAddress();

    constructor(
        address agentEconomyRewards,
        address treasury,
        address ecosystemIncentives,
        address foundingTeam,
        address strategicPartnerships,
        address liquidity
    ) ERC20("A2A402", "A2A402") {
        if (
            agentEconomyRewards == address(0) || treasury == address(0)
                || ecosystemIncentives == address(0) || foundingTeam == address(0)
                || strategicPartnerships == address(0) || liquidity == address(0)
        ) revert ZeroAllocationAddress();

        _mint(agentEconomyRewards, 400_000_000 ether);
        _mint(treasury, 250_000_000 ether);
        _mint(ecosystemIncentives, 150_000_000 ether);
        _mint(foundingTeam, 100_000_000 ether);
        _mint(strategicPartnerships, 50_000_000 ether);
        _mint(liquidity, 50_000_000 ether);
    }
}

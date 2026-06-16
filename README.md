# ⚡ MagicBlock Engine - Integration Examples

Scaling solution for performant, composable games and applications.

## ✨Overview

This repository contains examples of how to use the different features  available in an Ephemeral Rollup (ER).
Read more about Ephemeral Rollups [here](https://docs.magicblock.gg/EphemeralRollups/ephemeral_rollups).

> To view integrated demos for specific usecases, please look at [MagicBlock Starter Kits](https://github.com/magicblock-labs/starter-kits).

## 👷 Examples


<table>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./anchor-counter/">➕ Anchor Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
</p>
<p><em>Counter program in Anchor.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./rust-counter/">🦀 Rust Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Native%20Rust-ce422b?style=flat-square" alt="Native Rust"/>
</p>
<p><em>Counter program in native Rust.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./pinocchio-counter/">🪵 Pinocchio Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Pinocchio-f97316?style=flat-square" alt="Pinocchio"/>-
</p>
<p><em>Counter program built with Pinocchio.</em></p>
</blockquote>
</td>
</tr>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./pinocchio-ephemeral-permission-counter/">🪵 Pinocchio Private Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Pinocchio-f97316?style=flat-square" alt="Pinocchio"/>
<img src="https://img.shields.io/badge/Counter-64748b?style=flat-square" alt="Counter"/>
<img src="https://img.shields.io/badge/Ephemeral%20Permission-9333ea?style=flat-square" alt="Privacy"/>
</p>
<p><em>Pinocchio counter with ephemeral permission accounts on the ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./pinocchio-private-counter/">🔒 Pinocchio Private Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Pinocchio-f97316?style=flat-square" alt="Pinocchio"/>
<img src="https://img.shields.io/badge/Counter-64748b?style=flat-square" alt="Counter"/>
<img src="https://img.shields.io/badge/Private-7c3aed?style=flat-square" alt="Private"/>
<img src="https://img.shields.io/badge/TEE-059669?style=flat-square" alt="TEE"/>
</p>
<p><em>Pinocchio counter variant exercising private state on the ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./private-counter/">🔒 Private Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Counter-64748b?style=flat-square" alt="Counter"/>
<img src="https://img.shields.io/badge/Private-7c3aed?style=flat-square" alt="Private"/>
<img src="https://img.shields.io/badge/TEE-059669?style=flat-square" alt="TEE"/>
</p>
<p><em>Anchor counter gated by an on-rollup ephemeral permission account.</em></p>
</blockquote>
</td>
</tr>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./session-keys/">🔑 Session Keys</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Counter-64748b?style=flat-square" alt="Counter"/>
<img src="https://img.shields.io/badge/Session%20Keys-6366f1?style=flat-square" alt="Session Keys"/>
</p>
<p><em>Counter using gpl-session keys for delegated-signer auth on both base chain and ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./crank-counter/">⏱️ Crank Counter</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Counter-64748b?style=flat-square" alt="Counter"/>
<img src="https://img.shields.io/badge/Crank-d97706?style=flat-square" alt="Crank"/>
</p>
<p><em>Counter driven by MagicBlock's scheduled crank system.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./ephemeral-account-chats/">💬 Ephemeral Account Chats</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Chat-0891b2?style=flat-square" alt="Chat"/>
<img src="https://img.shields.io/badge/Ephemeral%20Accounts-9333ea?style=flat-square" alt="Ephemeral Accounts"/>
</p>
<p><em>Chat program using Anchor "ephemeral accounts" (state lives only on the ER).</em></p>
</blockquote>
</td>
</tr>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./dummy-token-transfer/">🪙 Dummy Token Transfer</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Token-0d9488?style=flat-square" alt="Token"/>
<img src="https://img.shields.io/badge/Delegate-0284c7?style=flat-square" alt="Delegate"/>
</p>
<p><em>Token transferer that can delegate and execute on both the base chain and the ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./spl-tokens/">💰 SPL Tokens</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/SPL%20Token-9945FF?style=flat-square" alt="SPL Token"/>
<img src="https://img.shields.io/badge/Delegate-0284c7?style=flat-square" alt="Delegate"/>
</p>
<p><em>SPL token delegation example with transfers on the ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./private-payments/">🛡️ Private Payments</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js"/>
<img src="https://img.shields.io/badge/Private%20Payments-7c3aed?style=flat-square" alt="Private Payments"/>
</p>
<p><em>Next.js demo for MagicBlock private payments.</em></p>
</blockquote>
</td>
</tr>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./roll-dice/">🎲 Roll Dice</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/VRF-4f46e5?style=flat-square" alt="VRF"/>
<img src="https://img.shields.io/badge/Game-e11d48?style=flat-square" alt="Game"/>
</p>
<p><em>Dice roll using a verifiable random function (VRF) on the ER.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./pinocchio-roll-dice/">🎲 Pinocchio Roll Dice</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Pinocchio-f97316?style=flat-square" alt="Pinocchio"/>
<img src="https://img.shields.io/badge/VRF-4f46e5?style=flat-square" alt="VRF"/>
<img src="https://img.shields.io/badge/Game-e11d48?style=flat-square" alt="Game"/>
</p>
<p><em>Pinocchio (no-Anchor) VRF dice variant.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./rewards-delegated-vrf/">🏆 Rewards (Delegated VRF)</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/VRF-4f46e5?style=flat-square" alt="VRF"/>
<img src="https://img.shields.io/badge/Rewards-ca8a04?style=flat-square" alt="Rewards"/>
</p>
<p><em>Rewards distribution program using delegated VRF.</em></p>
</blockquote>
</td>
</tr>
<tr>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./rock-paper-scissor/">✊ Rock Paper Scissor</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Game-e11d48?style=flat-square" alt="Game"/>
<img src="https://img.shields.io/badge/TEE-059669?style=flat-square" alt="TEE"/>
</p>
<p><em>Two-player RPS with hidden moves on the ER until reveal.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./magic-actions/">✨ Magic Actions</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/Cross--chain-2563eb?style=flat-square" alt="Cross-chain"/>
</p>
<p><em>Execute base-chain actions from inside an Ephemeral Rollup.</em></p>
</blockquote>
</td>
<td valign="top" width="33%">
<blockquote>
<p><strong><a href="./oncurve-delegation/">📈 On-Curve Delegation</a></strong></p>
<p>
<img src="https://img.shields.io/badge/Anchor-5243AA?style=flat-square" alt="Anchor"/>
<img src="https://img.shields.io/badge/On--curve-475569?style=flat-square" alt="On-curve"/>
<img src="https://img.shields.io/badge/Delegate-0284c7?style=flat-square" alt="Delegate"/>
</p>
<p><em>Delegate on-curve (non-PDA) accounts to the ER and manage their lifecycle.</em></p>
</blockquote>
</td>
</tr>
</table>

## Backward Compatibility

Older pre-Anchor 1.0 versions of the migrated programs are kept in
[00-LEGACY_EXAMPLES](./00-LEGACY_EXAMPLES/README.md). The `00-` prefix keeps
these compatibility references listed before the active examples in
alphabetical folder views. These examples are for users who still need the
previous Anchor 0.32.1 implementations while upgrading to the current Anchor 1.0
programs.

## 🚧 Under Testing 🚧

The Ephemeral Rollups are currently under testing. Reach out to us on [Discord](https://discord.com/invite/MBkdC3gxcv) to get access to the testing endpoint.

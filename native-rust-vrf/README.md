# rust-native-vrf-example

Native Solana program (no Anchor) that uses **MagicBlock Ephemeral VRF** via `ephemeral-vrf-sdk`: the user **requests** randomness; the **VRF program** **callbacks** with 32 bytes; you **derive** a value (e.g. 1–6) and store it in `PlayerState`.

**Program id:** `5hExoUW5SvPxTHTcz3ok117BoLa1TzzG6KZZfWD23DfD` (see `src/lib.rs`).

---

## Instructions (what each one does)

### `InitializePlayer` (Borsh: wallet → your program)

- **Caller:** user (signs as **authority**).
- **Effect:** creates the **player** PDA for seeds `["player", authority]`, writes `PlayerState` (discriminator, `random_value` initially `0`, bump).
- **File:** `src/instructions/initialize_player.rs`

### `RequestRandomness { client_seed: u8 }` (Borsh: wallet → your program)

- **Caller:** user (payer signs).
- **Effect:** checks queue / accounts, builds `RequestRandomnessParams` and CPIs the **ephemeral VRF** program with `create_request_randomness_ix`. Your program signs the CPI using the **identity** PDA (`["identity"]` under this program). The request encodes *which* callback to run and *which* accounts the VRF will pass when it invokes you (e.g. the player PDA as writable). **This instruction does not** set the final roll; it only records the request on-chain and triggers the VRF.
- **File:** `src/instructions/request_randomness.rs`

### VRF callback → `CallbackConsumeRandomness` (not plain Borsh on the same enum)

- **Caller:** the **VRF** program, not the user. Instruction data = fixed **8-byte** prefix (see `vrf_lite::CALLBACK_CONSUME_RANDOMNESS`) **+ 32** random bytes (40 bytes total). `src/processor.rs` routes this **before** `VrfInstruction::try_from_slice`, because it is not the same layout as your wallet Borsh instructions.
- **Effect:** verifies `VRF_PROGRAM_IDENTITY` is the signer, parses the 32-byte seed, maps it (e.g. `rnd::random_u8_with_range` → 1–10), updates `PlayerState.random_value` on the player PDA.
- **Files:** `src/vrf_lite.rs`, `src/instructions/callback_consume_randomness.rs`

---

## Build and deploy

```bash
cargo build-sbf
solana program deploy target/deploy/<your_program>.so --program-id reflex_program-keypair.json
```

Upgrade the same program id when you change the `.so` (redeploy with the same program keypair).

---

## Client tests (`test/`)

```bash
cd test
npm install
# Off-chain Borsh checks only
npm test
# On-chain: devnet (or set SOLANA_RPC_URL / SOLANA_WS_URL); needs payer keypair
RUN_INTEGRATION=1 npm test
```

- **`RUN_INIT_INTEGRATION=1`:** also runs the `initialize_player` chain test (default off so you can focus on VRF if the player PDA already exists).
- **`AUTO_INIT_PLAYER=1`:** with `RUN_INTEGRATION=1`, creates the player PDA if missing before the VRF test.

`PROGRAM_ID` in the client matches `getTestProgramId()` in `test/utils.ts` (override with env).

---

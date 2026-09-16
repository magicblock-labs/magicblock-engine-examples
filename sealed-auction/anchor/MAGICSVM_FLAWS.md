# MagicSVM flaws: sealed-auction private bids

MagicSVM cannot support the private-bid / permission checks in
`tests/sealed-auction.ts`. Tests were not adapted (bids were not made public).

## Original checks that require permission / privacy

The live ER flow (`RUN_SEALED_AUCTION_LIVE=1`) is the sealed-bid lifecycle the
MagicSVM copy is supposed to replicate:

1. `getAuthToken` + TEE-authenticated connections for the auctioneer and each
   bidder (`authenticatedErConnection`, and
   `it("can create TEE-authenticated bidder connections for privacy probes")`).
2. After `place_bid`, `init_bid_permission` CPIs to `PERMISSION_PROGRAM_ID`
   (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`) with
   `CreateEphemeralPermissionCpi { is_private: true, members: [auctioneer, bidder] }`.
3. `settle_winning_bid` and `claim_refund` pass
   `bidPermission: permissionPdaFromAccount(bid)` and close that account via
   `CloseEphemeralPermissionCpi`. The permission program rejects a close unless
   the account discriminator is the v2 permission header (`1`), not empty data.
4. Static checks that always run also depend on the permission surface:
   `permissionPdaFromAccount(auction/bid)` is a real PDA, and
   `PERMISSION_PROGRAM_ID !== ASSOCIATED_TOKEN_PROGRAM_ID`.

Making bids public (skipping `init_bid_permission`, or creating
`is_private: false` permissions) would hide exactly these checks.

## What MagicSVM does

### 1. Permission program is not loaded

`MagicSVM::new()` installs DLP, ESPL, and a builtin Magic program. It does **not**
install `PERMISSION_PROGRAM_ID`.

```
svm.getAccount("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1")
→ { exists: false }
svm.getAccountFor(..., { target: "ephemeral" })
→ { exists: false }
```

`init_bid_permission` therefore cannot CPI to the permission program on a stock
MagicSVM.

### 2. Loading the permission program still drops private permission data

A probe loaded
`permission-program/target/deploy/magicblock_permission_program.so` and sent
`CreateEphemeralPermission` (discriminator `6`, `is_private = 1`, one authority
member) to the ephemeral ledger, matching the SDK account order used by
`sealed-auction` (`payer`, `permissioned_account`, `permission`, vault,
magic program).

The transaction **succeeds**:

```
Program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 invoke [1]
Program Magic11111111111111111111111111111111111111 invoke [2]
Program Magic11111111111111111111111111111111111111 success
Program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 consumed 6131 of 200000 compute units
Program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1 success
```

After the send, the permission PDA exists and is owned by the permission
program, but its 101-byte data is **all zeros** (`private` flag at byte 34 is
`0`, not `1`). The permission program writes discriminator, bump,
permissioned account, `private`, and members during the same instruction;
MagicSVM’s post-transaction `create_ephemeral_account` effect then recreates
the account from a zeroed `AccountSharedData::new(0, data_len, owner)` when the
in-transaction 0-lamport account is gone.

`close_bid_permission` / `CloseEphemeralPermission` then fails with
`InvalidAccountData` because `header.discriminator != PERMISSION_DISCRIMINATOR`.
`settle_winning_bid` and `claim_refund` cannot pass.

This is a MagicSVM lifecycle bug (ephemeral create does not keep bytes written
in the creating transaction), not a harness account-list mistake.

### 3. No TEE auth / privacy filter

`getAuthToken` is an HTTP TEE handshake. MagicSVM has no RPC, no TEE endpoint,
and `getAccountFor` returns every account with no member / `is_private` filter.
The privacy-probe test (`token.length > 0` plus an authenticated
`getLatestBlockhash`) cannot run in-process.

## Why we stopped

- Replicating the sealed-bid expects requires a private permission account that
  settle/refund can close.
- MagicSVM does not ship that program, and even when the program is loaded the
  private header does not persist.
- Skipping `init_bid_permission` or flipping `is_private` would make the suite
  pass while hiding the missing permission program and the wiped ephemeral
  permission data.

No `tests-magicsvm` / `tests-magicsvm-rs` suite was added.

//! Private-counter logic ported from the Anchor `private-counter` example to
//! Pinocchio, using the **EphemeralPermission** flow:
//!
//! 1. `initialize` (base): allocate the counter PDA, set `authority`, and
//!    pre-fund it with enough lamports to cover the ephemeral-permission rent
//!    that will be paid on the ER post-delegation.
//! 2. `delegate` (base): delegate the counter PDA to the ER. No permission
//!    delegation step — ephemeral permissions live entirely on the ER.
//! 3. `init_permission` (ER): PDA-signed `CreateEphemeralPermission`. Idempotent.
//! 4. `set_privacy` (ER): toggle privacy via `UpdateEphemeralPermission`. When
//!    private, the counter's `authority` is the sole member with logs/message/
//!    balances visibility.
//! 5. `close_permission` (ER): `CloseEphemeralPermission`, refunds rent to the
//!    counter PDA.
//! 6. `commit` / `commit_and_undelegate` / `increment_and_*` use the
//!    `MagicIntentBundleBuilder` — no extra permission CPI needed.

use crate::state::Counter;
use ephemeral_rollups_pinocchio::acl::{
    CloseEphemeralPermission, CreateEphemeralPermission, EphemeralMembersArgs, EphemeralPermission,
    Member, MemberFlags, UpdateEphemeralPermission,
};
use ephemeral_rollups_pinocchio::instruction::{delegate_account, undelegate};
use ephemeral_rollups_pinocchio::intent_bundle::MagicIntentBundleBuilder;
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use pinocchio::sysvars::rent::Rent;
use pinocchio::sysvars::Sysvar;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

const INTENT_BUNDLE_DATA_BUF_SIZE: usize = 512;

/// Buffer size for EphemeralPermission CPI data: discriminator (8) +
/// `EphemeralMembersArgs` body (1 + members * 33). For up to 1 member that's
/// 8 + 1 + 33 = 42 bytes; round up to 64 for slack on Update calls that may
/// transition between 0 and 1 members.
const PERMISSION_CPI_BUF: usize = 64;

/// Mirrors `ephemeral_rollups_sdk::ephemeral_accounts::rent`: ephemeral
/// accounts cost 32 lamports/byte with a 60-byte overhead. For
/// `EphemeralPermission::size_of(1)` ≈ 101 bytes → ~5152 lamports of rent.
/// The Pinocchio SDK doesn't expose this helper; we inline it.
const EPHEMERAL_RENT_PER_BYTE: u64 = 32;
const EPHEMERAL_ACCOUNT_OVERHEAD: u32 = 60;

#[inline]
const fn ephemeral_rent(data_len: u32) -> u64 {
    (data_len as u64 + EPHEMERAL_ACCOUNT_OVERHEAD as u64) * EPHEMERAL_RENT_PER_BYTE
}

/// Derive the counter PDA from the caller-provided bump.
fn counter_address_from_bump(
    program_id: &Address,
    authority: &Address,
    bump: u8,
) -> Result<Address, ProgramError> {
    let bump_seed = [bump];
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    {
        Address::create_program_address(&[b"counter", authority.as_ref(), &bump_seed], program_id)
            .map_err(|_| ProgramError::InvalidArgument)
    }
    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    {
        use solana_pubkey::Pubkey;
        let program_pubkey = Pubkey::new_from_array(*program_id.as_array());
        let authority_pubkey = Pubkey::new_from_array(*authority.as_array());
        let pda = Pubkey::create_program_address(
            &[b"counter", authority_pubkey.as_ref(), &bump_seed],
            &program_pubkey,
        )
        .map_err(|_| ProgramError::InvalidArgument)?;
        Ok(Address::new_from_array(pda.to_bytes()))
    }
}

/// Create and initialize the counter PDA, pre-funded for its ephemeral permission.
///
/// Pre-funding here means the counter PDA, after delegation, carries enough
/// lamports onto the ER to cover the rent of the `EphemeralPermission` account
/// when `init_permission` is called on the ER.
pub fn process_initialize_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    // Trailing `..` so the test can pass extra accounts (perm/delegation
    // accounts left over from the old base-layer-permission flow) without
    // forcing a strict re-wire.
    let [authority_account, counter_account, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let bump_seed = [bump];
    let counter_pda = counter_address_from_bump(program_id, authority_account.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(authority_account.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds_array);

    if counter_account.lamports() == 0 {
        // Base-layer rent for the counter PDA itself, plus the ER-side rent
        // for one EphemeralPermission account that will be created post-delegation.
        // Hardcoded base rent is generous; the ER prefund is computed exactly.
        let base_rent_exempt: u64 = Rent::get()?.try_minimum_balance(Counter::SIZE)?;
        let ephemeral_permission_rent = ephemeral_rent(EphemeralPermission::size_of(1) as u32);
        let total_lamports = base_rent_exempt
            .checked_add(ephemeral_permission_rent)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        log!("Creating counter with prefund");
        let create_account_ix = CreateAccount {
            from: authority_account,
            to: counter_account,
            lamports: total_lamports,
            space: Counter::SIZE as u64,
            owner: program_id,
        };
        create_account_ix
            .invoke_signed(&[signer.clone()])
            .map_err(|_| {
                log!("Counter creation failed");
                ProgramError::Custom(100)
            })?;
    }

    // Initialize fields.
    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count = 0;
        counter_data.authority = *authority_account.address();
    }

    log!("Counter initialized");
    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_increase_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [authority_account, counter_account, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority_account.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count = counter_data
        .count
        .checked_add(increase_by)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}

/// Delegate the counter PDA to the ER. No permission delegation needed —
/// ephemeral permissions are created directly on the ER post-delegation.
pub fn process_delegate(
    _program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [authority, pda_to_delegate, owner_program, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, system_program, rest @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let validator = rest.first().map(|account| {
        #[cfg(feature = "logging")]
        {
            pinocchio_log::log!("validator");
            account.address().log();
        }
        *account.address()
    });

    let counter_pda =
        counter_address_from_bump(owner_program.address(), authority.address(), bump)?;
    if counter_pda != *pda_to_delegate.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let seeds: &[&[u8]] = &[b"counter", authority.address().as_ref()];
    delegate_account(
        &[
            authority,
            pda_to_delegate,
            owner_program,
            delegation_buffer,
            delegation_record,
            delegation_metadata,
            system_program,
        ],
        seeds,
        bump,
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Create the ephemeral permission on the ER.
///
/// Idempotent: skips if the permission account already has lamports. The
/// counter PDA (delegated, with prefunded lamports) is the payer and signs
/// via its seeds.
pub fn process_init_permission(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [authority, counter_account, permission, vault, magic_program, permission_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    if permission.lamports() > 0 {
        log!("Permission already exists, skipping creation");
        return Ok(());
    }

    let bump_seed = [bump];
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(authority.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds_array);

    // Empty members + is_private=false → public permission to start.
    let members: [Member; 0] = [];
    CreateEphemeralPermission {
        payer: counter_account,
        permissioned_account: counter_account,
        permission,
        vault,
        magic_program,
        permission_program,
        args: EphemeralMembersArgs {
            is_private: false,
            members: &members,
        },
    }
    .invoke_signed::<PERMISSION_CPI_BUF>(&[signer])?;
    log!("Ephemeral permission created");
    Ok(())
}

/// Toggle the privacy flag on the ephemeral permission.
///
/// When `is_private` is true, only the counter's authority is allowed to read
/// state via the TEE (logs, messages, balances). When false, the permission
/// is public.
pub fn process_set_privacy(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    is_private: bool,
) -> ProgramResult {
    let [authority, counter_account, permission, vault, magic_program, permission_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let bump_seed = [bump];
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(authority.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds_array);

    // Read the counter's stored authority — that's the only member when private.
    let counter_authority = {
        let data = counter_account.try_borrow()?;
        Counter::load(&data)?.authority
    };

    let single_member = [Member {
        flags: MemberFlags::from_acl_flag_byte(
            MemberFlags::TX_LOGS
                | MemberFlags::TX_MESSAGE
                | MemberFlags::TX_BALANCES
                | MemberFlags::ACCOUNT_SIGNATURES,
        ),
        pubkey: counter_authority,
    }];
    let members: &[Member] = if is_private { &single_member } else { &[] };

    log!("Toggling privacy");
    UpdateEphemeralPermission {
        payer: counter_account,
        permissioned_account: counter_account,
        permission,
        vault,
        magic_program,
        permission_program,
        authority: counter_account,
        authority_is_signer: false, // PDA signs via the seeds above
        args: EphemeralMembersArgs {
            is_private,
            members,
        },
    }
    .invoke_signed::<PERMISSION_CPI_BUF>(&[signer])?;
    Ok(())
}

/// Close the ephemeral permission, refunding rent to the counter PDA.
pub fn process_close_permission(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [authority, counter_account, permission, vault, magic_program, permission_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let bump_seed = [bump];
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(authority.address().as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds_array);

    CloseEphemeralPermission {
        payer: counter_account,
        permissioned_account: counter_account,
        permission,
        vault,
        magic_program,
        permission_program,
        authority: counter_account,
        authority_is_signer: false,
    }
    .invoke_signed(&[signer])?;
    log!("Ephemeral permission closed");
    Ok(())
}

/// Commit the counter PDA state to the base layer.
pub fn process_commit(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [authority, counter_account, magic_program, magic_context, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut intent_bundle_data = [0u8; INTENT_BUNDLE_DATA_BUF_SIZE];
    MagicIntentBundleBuilder::new(*authority, *magic_context, *magic_program)
        .commit(&[*counter_account])
        .build_and_invoke(&mut intent_bundle_data)?;
    Ok(())
}

/// Commit the counter PDA state and undelegate it. No separate permission
/// undelegation step — ephemeral permissions are confined to the ER and can be
/// closed independently via `close_permission` before this call.
pub fn process_commit_and_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
) -> ProgramResult {
    let [authority, counter_account, magic_program, magic_context, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (counter_pda, _bump_seed) =
        Address::find_program_address(&[b"counter", authority.address().as_ref()], program_id);
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut intent_bundle_data = [0u8; INTENT_BUNDLE_DATA_BUF_SIZE];
    MagicIntentBundleBuilder::new(*authority, *magic_context, *magic_program)
        .commit_and_undelegate(&[*counter_account])
        .build_and_invoke(&mut intent_bundle_data)?;
    Ok(())
}

/// Increment + commit in one instruction.
pub fn process_increment_commit(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [authority, counter_account, magic_program, magic_context, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count = counter_data
            .count
            .checked_add(increase_by)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut intent_bundle_data = [0u8; INTENT_BUNDLE_DATA_BUF_SIZE];
    MagicIntentBundleBuilder::new(*authority, *magic_context, *magic_program)
        .commit(&[*counter_account])
        .build_and_invoke(&mut intent_bundle_data)?;
    Ok(())
}

/// Increment + commit-and-undelegate in one instruction.
pub fn process_increment_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [authority, counter_account, magic_program, magic_context, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, authority.address(), bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count = counter_data
            .count
            .checked_add(increase_by)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut intent_bundle_data = [0u8; INTENT_BUNDLE_DATA_BUF_SIZE];
    MagicIntentBundleBuilder::new(*authority, *magic_context, *magic_program)
        .commit_and_undelegate(&[*counter_account])
        .build_and_invoke(&mut intent_bundle_data)?;
    Ok(())
}

/// Handle the callback emitted by the delegation program on undelegation.
pub fn process_undelegation_callback(
    program_id: &Address,
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated_acc, program_id, buffer_acc, payer, ix_data)?;
    Ok(())
}

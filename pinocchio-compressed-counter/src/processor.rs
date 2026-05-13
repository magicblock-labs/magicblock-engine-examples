use crate::state::Counter;
use ephemeral_rollups_pinocchio::compression::{
    build_pda_seeds, CdpCompressedAccountMeta, CdpPackedAddressTreeInfo, CdpValidityProof,
    DelegateCompressed, DelegateCompressedArgs, InitializeCompressedRecord,
    InitializeCompressedRecordArgs,
};
use ephemeral_rollups_pinocchio::instruction::undelegate;
use ephemeral_rollups_pinocchio::intent_bundle::MagicIntentBundleBuilder;
use pinocchio::sysvars::rent::Rent;
use pinocchio::sysvars::Sysvar;
use pinocchio::Address;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

/// Create and initialize the counter PDA for the initializer.
pub fn process_initialize_counter(
    accounts: &[AccountView],
    id: Address,
    validity_proof: CdpValidityProof,
    address_tree_info: CdpPackedAddressTreeInfo,
    output_state_tree_index: u8,
) -> ProgramResult {
    let [payer_info, counter_info, compression_program, _system_program, remaining_accounts @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (counter_pda, bump) = Counter::find_pda(&id);
    if counter_pda != *counter_info.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Create counter account.
    let rent_exempt_lamports = Rent::get()?.try_minimum_balance(Counter::SIZE)?;
    let create_account_ix = CreateAccount {
        from: payer_info,
        to: counter_info,
        lamports: rent_exempt_lamports,
        space: Counter::SIZE as u64,
        owner: &crate::ID,
    };

    let bump_seed = [bump];
    let seed_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seed_array);
    create_account_ix.invoke_signed(&[signer.clone()])?;

    // Init compressed record
    let mut borsh_pda_seeds_buf = [0_u8; 4 + 4 + 7 + 4 + 32];
    let borsh_pda_seeds = build_pda_seeds(
        &mut borsh_pda_seeds_buf,
        &[b"counter".as_ref(), id.as_ref()],
    );
    InitializeCompressedRecord {
        payer: payer_info,
        delegated_account: counter_info,
        compressed_delegation_program: compression_program,
        remaining_accounts,
        args: InitializeCompressedRecordArgs {
            validity_proof,
            address_tree_info,
            output_state_tree_index,
            owner_program_id: &crate::ID,
            borsh_pda_seeds,
            bump: bump,
        },
    }
    .invoke_signed(&[signer])?;

    // Initialize counter to 0.
    let mut data = counter_info.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count = 0;
    counter_data.id = id;

    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_increase_counter(accounts: &[AccountView], increase_by: u64) -> ProgramResult {
    let [counter_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;

    let counter_pda = Counter::derive_pda(&counter_data.id, counter_data.bump)?;
    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    counter_data.count = counter_data
        .count
        .checked_add(increase_by)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    Ok(())
}

/// Delegate the counter PDA to the delegation program.
pub fn process_delegate(
    accounts: &[AccountView],
    validity_proof: CdpValidityProof,
    account_meta: CdpCompressedAccountMeta,
) -> ProgramResult {
    let [payer, counter_info, validator, compression_program, remaining_accounts @ ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let (id, bump) = {
        let mut data = counter_info.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        (counter_data.id, counter_data.bump)
    };

    let counter_pda = Counter::derive_pda(&id, bump)?;

    if counter_pda != *counter_info.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut borsh_pda_seeds_buf = [0_u8; 4 + 4 + 7 + 4 + 32 + 4 + 1];
    let bump_seed = [bump];
    let borsh_pda_seeds = build_pda_seeds(
        &mut borsh_pda_seeds_buf,
        &[b"counter".as_ref(), id.as_ref(), &bump_seed],
    );
    let signer_seeds = [
        Seed::from(b"counter"),
        Seed::from(id.as_ref()),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&signer_seeds);
    DelegateCompressed {
        payer,
        delegated_account: counter_info,
        compressed_delegation_program: compression_program,
        remaining_accounts,
        args: DelegateCompressedArgs {
            validity_proof,
            account_meta,
            owner_program_id: &crate::ID,
            validator: validator.address(),
            account_data: &counter_info.try_borrow()?,
            borsh_pda_seeds,
            bump: bump,
        },
    }
    .invoke_signed(&[signer.clone()])?;

    Ok(())
}

/// Undelegate the counter PDA from the delegation program.
pub fn process_undelegate(accounts: &[AccountView]) -> ProgramResult {
    let [payer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut data = [0_u8; 1024];
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit_and_undelegate(&[counter_account.clone()])
        .compressed()
        .build_and_invoke(&mut data)?;

    Ok(())
}

/// Handle the callback emitted by the delegation program on undelegation.
pub fn process_undelegation_callback(accounts: &[AccountView], ix_data: &[u8]) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated_acc, &crate::ID, buffer_acc, payer, ix_data)?;
    Ok(())
}

use crate::{instruction::ProgramInstruction, state::Counter};
use ephemeral_rollups_pinocchio::instruction::delegate_account;
use ephemeral_rollups_pinocchio::instruction::{
    commit_accounts, commit_and_undelegate_accounts, undelegate,
};
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = ProgramInstruction::unpack(instruction_data)?;

    match instruction {
        ProgramInstruction::InitializeCounter => process_initialize_counter(program_id, accounts),
        ProgramInstruction::IncreaseCounter { increase_by } => {
            process_increase_counter(program_id, accounts, increase_by)
        }
        ProgramInstruction::Delegate => process_delegate(program_id, accounts),
        ProgramInstruction::CommitAndUndelegate => {
            process_commit_and_undelegate(program_id, accounts)
        }
        ProgramInstruction::Commit => process_commit(program_id, accounts),
        ProgramInstruction::IncrementAndCommit { increase_by } => {
            process_increment_commit(program_id, accounts, increase_by)
        }
        ProgramInstruction::IncrementAndUndelegate { increase_by } => {
            process_increment_undelegate(program_id, accounts, increase_by)
        }
        ProgramInstruction::UndelegationCallback { ix_data } => {
            process_undelegation_callback(program_id, accounts, &ix_data)
        }
    }
}

pub fn process_initialize_counter(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer_account = accounts[0];
    let counter_account = accounts[1];
    let _system_program = accounts[2];

    let (counter_pda, bump_seed) = Address::find_program_address(
        &[b"counter", initializer_account.address().as_ref()],
        program_id,
    );

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Create counter account if it doesn't exist
    if counter_account.lamports() == 0 {
        let rent_exempt_lamports = 1_000_000;

        let create_account_ix = CreateAccount {
            from: &initializer_account,
            to: &counter_account,
            lamports: rent_exempt_lamports,
            space: Counter::SIZE as u64,
            owner: program_id,
        };

        let seed_array: [Seed; 3] = [
            Seed::from(b"counter"),
            Seed::from(initializer_account.address().as_ref()),
            Seed::from(core::slice::from_ref(&bump_seed)),
        ];
        let signer = Signer::from(&seed_array);
        create_account_ix.invoke_signed(&[signer])?;
    }

    // Initialize counter to 0
    let mut counter_data = Counter::from_bytes(&counter_account.try_borrow()?)?;
    counter_data.count = 0;
    counter_data.to_bytes(&mut counter_account.try_borrow_mut()?)?;

    Ok(())
}

pub fn process_increase_counter(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer_account = accounts[0];
    let counter_account = accounts[1];

    let (counter_pda, _bump_seed) = Address::find_program_address(
        &[b"counter", initializer_account.address().as_ref()],
        program_id,
    );

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut counter_data = Counter::from_bytes(&counter_account.try_borrow()?)?;
    counter_data.count += increase_by;
    counter_data.to_bytes(&mut counter_account.try_borrow_mut()?)?;

    Ok(())
}

pub fn process_delegate(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer = &accounts[0];
    let system_program = &accounts[1];
    let pda_to_delegate = &accounts[2];
    let owner_program = &accounts[3];
    let delegation_buffer = &accounts[4];
    let delegation_record = &accounts[5];
    let delegation_metadata = &accounts[6];
    let validator = if accounts.len() > 8 {
        Some(*accounts[8].address())
    } else {
        None
    };

    let seed_1 = b"counter";
    let seed_2 = initializer.address().as_ref();
    let seeds: &[&[u8]] = &[seed_1, seed_2];

    let delegate_config = DelegateConfig {
        validator: validator,
        ..Default::default()
    };

    let (_, bump) = Address::find_program_address(seeds, owner_program.address());

    delegate_account(
        &[
            initializer,
            pda_to_delegate,
            owner_program,
            delegation_buffer,
            delegation_record,
            delegation_metadata,
            system_program,
        ],
        seeds,
        bump,
        delegate_config,
    )?;

    Ok(())
}

pub fn process_commit(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer = &accounts[0];
    let counter_account = &accounts[1];
    let magic_program = &accounts[2];
    let magic_context = &accounts[3];

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_commit_and_undelegate(
    _program_id: &Address,
    accounts: &[AccountView],
) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer = &accounts[0];
    let counter_account = &accounts[1];
    let magic_program = &accounts[2];
    let magic_context = &accounts[3];

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_increment_commit(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer = &accounts[0];
    let counter_account = &accounts[1];
    let magic_program = &accounts[2];
    let magic_context = &accounts[3];

    let (counter_pda, _bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], program_id);

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut counter_data = Counter::from_bytes(&counter_account.try_borrow()?)?;
    counter_data.count += increase_by;
    counter_data.to_bytes(&mut counter_account.try_borrow_mut()?)?;

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_increment_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
    increase_by: u64,
) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let initializer = &accounts[0];
    let counter_account = &accounts[1];
    let magic_program = &accounts[2];
    let magic_context = &accounts[3];

    let (counter_pda, _bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], program_id);

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut counter_data = Counter::from_bytes(&counter_account.try_borrow()?)?;
    counter_data.count += increase_by;
    counter_data.to_bytes(&mut counter_account.try_borrow_mut()?)?;

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_undelegation_callback(
    program_id: &Address,
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    log!("Undelegating ...");
    undelegate(delegated_acc, program_id, buffer_acc, payer, &ix_data)?;
    log!("Undelegated successfully.");
    Ok(())
}

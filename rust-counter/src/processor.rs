use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

use ephemeral_rollups_sdk::cpi::{
    delegate_account, undelegate_account, DelegateAccounts, DelegateConfig,
};
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

use crate::{instruction::ProgramInstruction, state::Counter};

// program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Unpack instruction discriminator and instruction data
    let instruction = ProgramInstruction::unpack(_instruction_data)?;

    // Call the corresponding function
    match instruction {
        // 0: InitializeCounter
        ProgramInstruction::InitializeCounter => {
            msg!("Instruction: InitializeCounter");
            process_initialize_counter(program_id, accounts)
        }

        // 1: IncreaseCounter
        ProgramInstruction::IncreaseCounter { increase_by } => {
            msg!("Instruction: IncreaseCounter");
            process_increase_counter(program_id, accounts, increase_by)
        }

        // 2: Delegate
        ProgramInstruction::Delegate => {
            msg!("Instruction: Delegate");
            process_delegate(program_id, accounts)
        }

        // 3: CommitAndUndelegate
        ProgramInstruction::CommitAndUndelegate => {
            msg!("Instruction: CommitAndUndelegate");
            process_commit_and_undelegate(program_id, accounts)
        }

        // 4: Commit
        ProgramInstruction::Commit => {
            msg!("Instruction: Commit");
            process_commit(program_id, accounts)
        }

        // 5: IncrementAndCommit
        ProgramInstruction::IncrementAndCommit { increase_by } => {
            msg!("Instruction: IncrementAndCommit");
            process_increment_commit(program_id, accounts, increase_by)
        }

        // 6: IncrementAndUndelegate
        ProgramInstruction::IncrementAndUndelegate { increase_by } => {
            msg!("Instruction: IncrementAndUndelegate");
            process_increment_undelegate(program_id, accounts, increase_by)
        }

        // 7: Undelegate
        ProgramInstruction::Undelegate { pda_seeds } => {
            msg!("Instruction: Undelegate");
            process_undelegate(program_id, accounts, pda_seeds)
        }
    }
}

pub fn process_initialize_counter(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    // Iterating accounts
    let accounts_iter = &mut accounts.iter();
    let initializer_account = next_account_info(accounts_iter)?;
    let counter_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    // Check to ensure that you're using the right PDA
    let (counter_pda, bump_seed) = Pubkey::find_program_address(
        &[b"counter_account", initializer_account.key.as_ref()],
        program_id,
    );
    if counter_pda != *counter_account.key {
        msg!("Invalid seeds for PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Create counter account, if the account already exists, skip the creation step and update the count to 0
    let borrowed_lamports = counter_account.try_borrow_lamports().unwrap();
    if *borrowed_lamports == &mut 0 {
        let rent = Rent::get()?;
        let rent_lamports = rent.minimum_balance(Counter::SIZE);
        msg!(
            "Initializing counter account {} with {} lamports",
            counter_pda,
            rent_lamports
        );
        drop(borrowed_lamports);
        invoke_signed(
            &system_instruction::create_account(
                initializer_account.key,
                counter_account.key,
                rent_lamports,
                Counter::SIZE.try_into().unwrap(),
                program_id,
            ),
            &[
                initializer_account.clone(),
                counter_account.clone(),
                system_program.clone(),
            ],
            &[&[
                b"counter_account",
                initializer_account.key.as_ref(),
                &[bump_seed],
            ]],
        )?;
        msg!(
            "Counter account {} created with its owner {}",
            counter_pda,
            counter_account.owner
        );
    }

    let mut counter_data = Counter::try_from_slice(&counter_account.data.borrow())?;
    counter_data.count = 0;
    counter_data.serialize(&mut &mut counter_account.data.borrow_mut()[..])?;
    msg!("PDA {} count: {}", counter_account.key, counter_data.count);

    Ok(())
}

pub fn process_increase_counter(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    increase_by: u64,
) -> ProgramResult {
    // Iterating accounts
    let accounts_iter = &mut accounts.iter();
    let initializer_account = next_account_info(accounts_iter)?;
    let counter_account = next_account_info(accounts_iter)?;

    // Check to ensure that you're using the right PDA derived from initializer account
    let (counter_pda, _bump_seed) = Pubkey::find_program_address(
        &[b"counter_account", initializer_account.key.as_ref()],
        program_id,
    );
    if counter_pda != *counter_account.key {
        msg!("Invalid seeds for PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Increment by increase_by amount using deserialization and serialization
    let mut counter_data = Counter::try_from_slice(&counter_account.data.borrow())?;
    counter_data.count += increase_by;
    counter_data.serialize(&mut &mut counter_account.data.borrow_mut()[..])?;
    msg!("PDA {} count: {}", counter_account.key, counter_data.count);

    Ok(())
}

pub fn process_delegate(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let pda_to_delegate = next_account_info(account_info_iter)?;
    let owner_program = next_account_info(account_info_iter)?;
    let delegation_buffer = next_account_info(account_info_iter)?;
    let delegation_record = next_account_info(account_info_iter)?;
    let delegation_metadata = next_account_info(account_info_iter)?;
    let delegation_program = next_account_info(account_info_iter)?;

    // Prepare counter pda seeds
    let seed_1 = b"counter_account";
    let seed_2 = initializer.key.as_ref();
    let pda_seeds: &[&[u8]] = &[seed_1, seed_2];

    let delegate_accounts = DelegateAccounts {
        payer: initializer,
        pda: pda_to_delegate,
        owner_program,
        buffer: delegation_buffer,
        delegation_record,
        delegation_metadata,
        delegation_program,
        system_program,
    };

    let delegate_config = DelegateConfig {
        commit_frequency_ms: 30_000,
        validator: None,
    };

    delegate_account(delegate_accounts, pda_seeds, delegate_config)?;

    Ok(())
}

pub fn process_undelegate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    pda_seeds: Vec<Vec<u8>>,
) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let delegated_pda = next_account_info(account_info_iter)?;
    let delegation_buffer = next_account_info(account_info_iter)?;
    let initializer = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    // CPI on Solana
    undelegate_account(
        delegated_pda,
        program_id,
        delegation_buffer,
        initializer,
        system_program,
        pda_seeds,
    )?;

    Ok(())
}

pub fn process_commit(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let counter_account = next_account_info(account_info_iter)?;
    let magic_program = next_account_info(account_info_iter)?;
    let magic_context = next_account_info(account_info_iter)?;

    // Signer should be the same as the initializer
    if !initializer.is_signer {
        msg!("Initializer {} should be the signer", initializer.key);
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        vec![counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_commit_and_undelegate(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let counter_account = next_account_info(account_info_iter)?;
    let magic_program = next_account_info(account_info_iter)?;
    let magic_context = next_account_info(account_info_iter)?;

    // Signer should be the same as the initializer
    if !initializer.is_signer {
        msg!("Initializer {} should be the signer", initializer.key);
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Commit and undelegate counter_account on ER
    commit_and_undelegate_accounts(
        initializer,
        vec![counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_increment_commit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    increase_by: u64,
) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let counter_account = next_account_info(account_info_iter)?;
    let magic_program = next_account_info(account_info_iter)?;
    let magic_context = next_account_info(account_info_iter)?;

    // Check to ensure that you're using the right PDA derived from initializer account
    let (counter_pda, _bump_seed) =
        Pubkey::find_program_address(&[b"counter_account", initializer.key.as_ref()], program_id);
    if counter_pda != *counter_account.key {
        msg!("Invalid seeds for PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Increment by increase_by amount using deserialization and serialization
    let mut counter_data = Counter::try_from_slice(&counter_account.data.borrow())?;
    counter_data.count += increase_by;
    counter_data.serialize(&mut &mut counter_account.data.borrow_mut()[..])?;
    msg!("PDA {} count: {}", counter_account.key, counter_data.count);

    // Signer should be the same as the initializer
    if !initializer.is_signer {
        msg!("Initializer {} should be the signer", initializer.key);
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        vec![counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

pub fn process_increment_undelegate(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    increase_by: u64,
) -> ProgramResult {
    // Get accounts
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let counter_account = next_account_info(account_info_iter)?;
    let magic_program = next_account_info(account_info_iter)?;
    let magic_context = next_account_info(account_info_iter)?;

    // Check to ensure that you're using the right PDA derived from initializer account
    let (counter_pda, _bump_seed) =
        Pubkey::find_program_address(&[b"counter_account", initializer.key.as_ref()], program_id);
    if counter_pda != *counter_account.key {
        msg!("Invalid seeds for PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Increment by increase_by amount using deserialization and serialization
    let mut counter_data = Counter::try_from_slice(&counter_account.data.borrow())?;
    counter_data.count += increase_by;
    counter_data.serialize(&mut &mut counter_account.data.borrow_mut()[..])?;
    msg!("PDA {} count: {}", counter_account.key, counter_data.count);

    // Signer should be the same as the initializer
    if !initializer.is_signer {
        msg!("Initializer {} should be the signer", initializer.key);
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_and_undelegate_accounts(
        initializer,
        vec![counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

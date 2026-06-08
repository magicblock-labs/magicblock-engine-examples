use pinocchio::{cpi::Seed, error::ProgramError, Address};

// State structure for the counter
#[repr(C)]
pub struct Player {
    pub last_result: u8,
    pub rollnum: u8,
}

impl Player {
    pub const SEED: &[u8] = b"player";
    pub const SIZE: usize = 2;

    pub fn signer_seeds<'a>(user: &'a Address, bump_slice: &'a [u8]) -> [Seed<'a>; 3] {
        [
            Seed::from(Self::SEED),
            Seed::from(user.as_ref()),
            Seed::from(bump_slice),
        ]
    }

    pub fn seeds(user: &Address) -> [&[u8]; 2] {
        [Self::SEED, user.as_ref()]
    }

    pub fn find_pda(user: &Address) -> (Address, u8) {
        Address::find_program_address(&Self::seeds(user), &crate::ID)
    }

    pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        let ptr = data.as_mut_ptr() as *mut Self;
        if !(ptr as usize).is_multiple_of(core::mem::align_of::<Self>()) {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &mut *ptr })
    }
}

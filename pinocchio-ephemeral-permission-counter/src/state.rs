use pinocchio::{error::ProgramError, Address};

// State structure for the counter
#[repr(C)]
pub struct Counter {
    pub id: Address,
    pub count: u64,
    pub bump: u8,
    pub _pad: [u8; 7],
}

impl Counter {
    pub const SIZE: usize = 32 + 8 + 8;

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        let ptr = data.as_ptr() as *const Self;
        if !(ptr as usize).is_multiple_of(core::mem::align_of::<Self>()) {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &*ptr })
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

    pub fn find_pda(id: &Address) -> (Address, u8) {
        Address::find_program_address(&[b"counter", id.as_ref()], &crate::ID)
    }

    pub fn derive_pda(id: &Address, bump: &[u8]) -> Result<Address, ProgramError> {
        Address::create_program_address(&[b"counter", id.as_ref(), bump], &crate::ID)
            .map_err(|_| ProgramError::InvalidSeeds)
    }
}

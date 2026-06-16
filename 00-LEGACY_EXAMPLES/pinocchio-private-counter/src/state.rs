use pinocchio::{error::ProgramError, Address};

/// State structure for the counter.
///
/// Mirrors `private-counter`'s Anchor `Counter` so we can use the same
/// EphemeralPermission flow on the ER: the counter PDA pays for its own
/// ephemeral permission via PDA-signed CPI, and `authority` is the sole
/// "private" member when privacy is on.
#[repr(C)]
pub struct Counter {
    pub count: u64,
    pub authority: Address,
}

impl Counter {
    pub const SIZE: usize = 8 + 32; // count + authority

    pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        let ptr = data.as_mut_ptr() as *mut Self;
        #[allow(clippy::manual_is_multiple_of)]
        if (ptr as usize) % core::mem::align_of::<Self>() != 0 {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &mut *ptr })
    }

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidAccountData);
        }
        let ptr = data.as_ptr() as *const Self;
        #[allow(clippy::manual_is_multiple_of)]
        if (ptr as usize) % core::mem::align_of::<Self>() != 0 {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &*ptr })
    }
}

use pinocchio::error::ProgramError;

// State structure for the counter
#[repr(C)]
pub struct Counter {
    pub count: u64,
}

impl Counter {
    pub const SIZE: usize = 8;

    pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidArgument);
        }
        let ptr = data.as_mut_ptr() as *mut Self;
        if (ptr as usize) % core::mem::align_of::<Self>() != 0 {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &mut *ptr })
    }
}

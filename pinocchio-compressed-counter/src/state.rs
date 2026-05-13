use pinocchio::{error::ProgramError, Address};

// State structure for the counter
#[repr(C)]
pub struct Counter {
    pub count: u64,
    pub id: Address,
    pub bump: u8,
    pub _padding: [u8; 7],
}

impl Counter {
    pub const SIZE: usize = core::mem::size_of::<Self>();

    pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() != Self::SIZE {
            return Err(ProgramError::InvalidArgument);
        }
        Ok(unsafe { &mut *(data.as_mut_ptr() as *mut Self) })
    }

    pub fn find_pda(id: &Address) -> (Address, u8) {
        Address::find_program_address(&[b"counter", id.as_ref()], &crate::ID)
    }

    pub fn derive_pda(id: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        Address::create_program_address(&[b"counter", id.as_ref(), &bump_seed], &crate::ID)
            .map_err(|_| ProgramError::InvalidArgument)
    }
}

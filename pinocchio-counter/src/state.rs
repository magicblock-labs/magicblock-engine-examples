use pinocchio::error::ProgramError;

// State structure for the counter
#[repr(C)]
pub struct Counter {
    pub count: u64,
}

impl Counter {
    pub const SIZE: usize = 8;

    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidArgument);
        }
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&data[..8]);
        Ok(Counter {
            count: u64::from_le_bytes(bytes),
        })
    }

    pub fn to_bytes(&self, data: &mut [u8]) -> Result<(), ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidArgument);
        }
        data[..8].copy_from_slice(&self.count.to_le_bytes());
        Ok(())
    }
}

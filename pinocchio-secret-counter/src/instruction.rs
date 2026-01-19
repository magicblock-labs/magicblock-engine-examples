use pinocchio::error::ProgramError;
use pinocchio_log::log;

pub enum ProgramInstruction<'a> {
    InitializeCounter,
    IncreaseCounter { increase_by: u64 },
    Delegate,
    CommitAndUndelegate,
    Commit,
    IncrementAndCommit { increase_by: u64 },
    IncrementAndUndelegate { increase_by: u64 },
    UndelegationCallback { ix_data: &'a [u8] },
}

impl<'a> ProgramInstruction<'a> {
    pub fn unpack(input: &'a [u8]) -> Result<Self, ProgramError> {
        if input.len() < 8 {
            log!("ERROR: input too short, expected at least 8 bytes");
            return Err(ProgramError::InvalidInstructionData);
        }

        let (ix_discriminator, rest) = input.split_at(8);

        Ok(match ix_discriminator {
            [0, 0, 0, 0, 0, 0, 0, 0] => Self::InitializeCounter,
            [1, 0, 0, 0, 0, 0, 0, 0] => {
                if rest.len() < 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&rest[..8]);
                let increase_by = u64::from_le_bytes(bytes);
                Self::IncreaseCounter { increase_by }
            }
            [2, 0, 0, 0, 0, 0, 0, 0] => Self::Delegate,
            [3, 0, 0, 0, 0, 0, 0, 0] => Self::CommitAndUndelegate,
            [4, 0, 0, 0, 0, 0, 0, 0] => Self::Commit,
            [5, 0, 0, 0, 0, 0, 0, 0] => {
                if rest.len() < 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&rest[..8]);
                let increase_by = u64::from_le_bytes(bytes);
                Self::IncrementAndCommit { increase_by }
            }
            [6, 0, 0, 0, 0, 0, 0, 0] => {
                if rest.len() < 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&rest[..8]);
                let increase_by = u64::from_le_bytes(bytes);
                Self::IncrementAndUndelegate { increase_by }
            }
            [196, 28, 41, 206, 48, 37, 51, 167] => {
                log!("UndelegationCallback matched, rest length: {}", rest.len());
                Self::UndelegationCallback { ix_data: rest }
            }
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }
}

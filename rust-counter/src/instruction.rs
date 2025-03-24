// instruction.rs
use solana_program::{ program_error::ProgramError };
use borsh::{BorshDeserialize};

pub enum ProgramInstruction {
    InitializeCounter,
    IncreaseCounter {
        increase_by: u64
    },
    Delegate,
    CommitAndUndelegate,
    Commit,
    Undelegate {
        pda_seeds: Vec<Vec<u8>>
    }
}

#[derive(BorshDeserialize)]
struct IncreaseCounterPayload {
    increase_by: u64,
}

impl ProgramInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        // Ensure the input has at least 8 bytes for the variant
        if input.len() < 8 {
            return Err(ProgramError::InvalidInstructionData);
        }

        // Extract the first 8 bytes as variant
        let (variant_bytes, rest) = input.split_at(8);
        let mut variant = [0u8; 8];
        variant.copy_from_slice(variant_bytes);

        Ok(match variant {
            [0, 0, 0, 0, 0, 0, 0, 0] => Self::InitializeCounter,
            [1, 0, 0, 0, 0, 0, 0, 0] => {
                let payload = IncreaseCounterPayload::try_from_slice(rest)?;
                Self::IncreaseCounter {
                    increase_by: payload.increase_by,
                }
            },
            [2, 0, 0, 0, 0, 0, 0, 0] => Self::Delegate,
            [3, 0, 0, 0, 0, 0, 0, 0] => Self::CommitAndUndelegate,
            [4, 0, 0, 0, 0, 0, 0, 0] => Self::Commit,
            [196, 28, 41, 206, 48, 37, 51, 167] => { 
                let pda_seeds: Vec<Vec<u8>> = Vec::<Vec<u8>>::try_from_slice(rest)?;
                Self::Undelegate {
                    pda_seeds
                }
            }
            _ => return Err(ProgramError::InvalidInstructionData),
        })
    }
}
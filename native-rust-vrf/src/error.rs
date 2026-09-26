use solana_program::program_error::ProgramError;

/// Program-specific errors. Custom codes start at 0x1770 to avoid colliding with common SPL ranges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum VrfError {
    AlreadyInitialized = 0x1770,
    InvalidPda = 0x1771,
    InvalidInstructionData = 0x1772,
    AccountOrder = 0x1773,
    MissingSignature = 0x1774,
    InvalidSystemProgram = 0x1775,
    ExpectedUnallocatedPda = 0x1776,
    /// `callback_consume` must be invoked by the VRF (prefix + 32B); wallet cannot trigger it this way.
    CallbackUnexpectedUserInvoke = 0x1777,
    /// First account must be `ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY` and signer.
    InvalidVrfProgramIdentity = 0x1778,
    /// VRF callback `instruction_data` is not 8+32 with the expected prefix.
    InvalidCallbackData = 0x1779,
    /// `oracle_queue` must match the queue used with this cluster (we pin `DEFAULT_QUEUE` from the SDK).
    InvalidOracleQueue = 0x177a,
    /// `program identity` PDA (seeds `[identity]`) is wrong.
    InvalidProgramIdentityPda = 0x177b,
    /// `request_randomness` requires an initialized `Player` account.
    PlayerNotInitialized = 0x177c,
    /// PDA is not owned by this program or bad discriminator.
    InvalidPlayerState = 0x177d,
}

impl From<VrfError> for ProgramError {
    fn from(e: VrfError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

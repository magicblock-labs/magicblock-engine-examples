//! VRF request/callback contract shared with `ephemeral_vrf_sdk::instructions::RequestRandomnessParams`.
//! The VRF program invokes the callback with `ix.data` = `callback_discriminator` (what we set on
//! the request) **concatenated** with 32 random bytes. We use an Anchor-style 8-byte global hash so
//! the prefix cannot collide with a single user `VrfInstruction` Borsh byte.

/// `sha256("global:callback_consume_randomness")[..8]` — pass as `RequestRandomnessParams::callback_discriminator`.
pub const CALLBACK_CONSUME_RANDOMNESS: [u8; 8] = [
    0xfd, 0xfe, 0x8f, 0x24, 0xd9, 0x2f, 0x7b, 0xbc,
];

/// Total expected length for the VRF callback: prefix + 32 (randomness).
pub const VRF_CALLBACK_IX_LEN: usize = CALLBACK_CONSUME_RANDOMNESS.len() + 32;

/// Returns 32 random bytes after the fixed prefix, or an error.
pub fn parse_vrf_callback_randomness(instruction_data: &[u8]) -> Result<&[u8; 32], ()> {
    if instruction_data.len() != VRF_CALLBACK_IX_LEN {
        return Err(());
    }
    if &instruction_data[..8] != CALLBACK_CONSUME_RANDOMNESS.as_ref() {
        return Err(());
    }
    instruction_data[8..]
        .try_into()
        .map_err(|_| ())
}

pub fn is_vrf_callback_instruction(instruction_data: &[u8]) -> bool {
    parse_vrf_callback_randomness(instruction_data).is_ok()
}

mod generated;

use generated::accounts::{Group, Permission};
pub use generated::programs::MAGICBLOCK_PERMISSION_PROGRAM_ID as ID;
pub use generated::*;

impl Group {
    pub const LEN: usize = 1 + 1 + 32 + 32 * 32;
    pub const DISCRIMINATOR: u8 = 1;
}

impl Permission {
    pub const DISCRIMINATOR: u8 = 0;
}

use bolt_lang::*;

declare_id!("Bw1hH1X7pbsVdsk84pbj971P1NoFDcmTWxDEJbgi5ijy");

#[component(delegate)]
#[derive(Default)]
pub struct Counter {
    pub count: u64,
}

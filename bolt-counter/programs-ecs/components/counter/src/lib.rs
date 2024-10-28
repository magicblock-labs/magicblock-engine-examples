use bolt_lang::*;

declare_id!("8G57v8BL4myb9FtXwLiwionAGZcZBGno2Ckps2AsGXwV");

#[component(delegate)]
#[derive(Default)]
pub struct Counter {
    pub count: u64,
}

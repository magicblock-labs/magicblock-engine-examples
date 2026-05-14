use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemStruct};

#[proc_macro_attribute]
pub fn vrf(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemStruct);

    let struct_name = &input.ident;
    let fields = &input.fields;
    let original_attrs = &input.attrs;
    let mut new_fields = Vec::new();
    let mut has_program_identity = false;
    let mut has_slot_hashes = false;
    let mut has_vrf_program = false;
    let mut has_system_program = false;

    for field in fields.iter() {
        let field_attrs = field.attrs.clone();

        let field_name = match &field.ident {
            Some(name) => name,
            None => {
                return syn::Error::new_spanned(
                    field,
                    "Unnamed fields are not supported in this macro",
                )
                .to_compile_error()
                .into();
            }
        };

        let field_type = &field.ty;
        new_fields.push(quote! {
            #(#field_attrs)*
            pub #field_name: #field_type,
        });

        // Check for existing required fields
        if field_name.eq("program_identity") {
            has_program_identity = true;
        }
        if field_name.eq("vrf_program") {
            has_vrf_program = true;
        }
        if field_name.eq("slot_hashes") {
            has_slot_hashes = true;
        }
        if field_name.eq("system_program") {
            has_system_program = true;
        }
    }

    // Add missing required fields
    if !has_program_identity {
        new_fields.push(quote! {
            /// CHECK: Used to verify the identity of the program
            #[account(seeds = [b"identity"], bump)]
            pub program_identity: AccountInfo<'info>,
        });
    }
    if !has_vrf_program {
        new_fields.push(quote! {
            pub vrf_program: Program<'info, ::ephemeral_vrf_sdk::anchor::VrfProgram>,
        });
    }
    if !has_slot_hashes {
        new_fields.push(quote! {
            /// CHECK: Slot hashes sysvar
            #[account(address = ::solana_program::sysvar::slot_hashes::ID)]
            pub slot_hashes: AccountInfo<'info>,
        });
    }
    if !has_system_program {
        new_fields.push(quote! {
            pub system_program: Program<'info, System>,
        });
    }

    // Generate the new struct definition
    let expanded = quote! {
        #(#original_attrs)*
        pub struct #struct_name<'info> {
            #(#new_fields)*
        }

        impl<'info> #struct_name<'info> {
            fn invoke_signed_vrf<'a>(&self, payer: &'a AccountInfo<'info>, ix: &anchor_lang::solana_program::instruction::Instruction) -> anchor_lang::solana_program::entrypoint::ProgramResult {
                let bump = Pubkey::try_find_program_address(&[ephemeral_vrf_sdk::consts::IDENTITY], &crate::ID).ok_or(anchor_lang::prelude::ProgramError::InvalidSeeds)?;
                anchor_lang::solana_program::program::invoke_signed(
                    ix,
                    &[
                        payer.clone(),
                        self.program_identity.to_account_info(),
                        self.oracle_queue.to_account_info(),
                        self.system_program.to_account_info(),
                        self.slot_hashes.to_account_info(),
                    ],
                    &[&[ephemeral_vrf_sdk::consts::IDENTITY, &[bump.1]]],
                )
            }
        }
    };

    TokenStream::from(expanded)
}

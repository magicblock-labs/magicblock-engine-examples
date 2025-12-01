import * as beet from "@metaplex-foundation/beet";
import * as web3 from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const delegateStruct = new beet.FixableBeetArgsStruct(
  [
    ["instructionDiscriminator", beet.uniformFixedSizeArray(beet.u8, 8)],
    ["commit_frequency_ms", beet.u32],
    ["seeds", beet.array(beet.array(beet.u8))],
    ["validator", beet.coption(beet.uniformFixedSizeArray(beet.u8, 32))],
  ],
  "DelegateInstructionArgs"
);

const delegateInstructionDiscriminator = [0, 0, 0, 0, 0, 0, 0, 0];

export interface CreateDelegateInstructionAccounts {
  payer: web3.PublicKey;
  delegatedAccount: web3.PublicKey;
  ownerProgram: web3.PublicKey;
  delegationRecord?: web3.PublicKey;
  delegationMetadata?: web3.PublicKey;
  systemProgram?: web3.PublicKey;
  validator?: web3.PublicKey;
}

export interface CreateDelegateInstructionArgs {
  commit_frequency_ms?: number;
  seeds?: number[][];
}

export function createDelegateInstruction(
  accounts: CreateDelegateInstructionAccounts,
  args?: CreateDelegateInstructionArgs,
  programId: web3.PublicKey = DELEGATION_PROGRAM_ID
): web3.TransactionInstruction {
  const delegateBufferPda = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
    accounts.delegatedAccount,
    accounts.ownerProgram
  );
  const delegationRecordPda = delegationRecordPdaFromDelegatedAccount(
    accounts.delegatedAccount
  );
  const delegationMetadataPda = delegationMetadataPdaFromDelegatedAccount(
    accounts.delegatedAccount
  );

  args = args ?? {
    commit_frequency_ms: 4294967295,
    seeds: [],
  };

  const keys = [
    { pubkey: accounts.payer, isWritable: false, isSigner: true },
    { pubkey: accounts.delegatedAccount, isWritable: true, isSigner: true },
    { pubkey: accounts.ownerProgram, isWritable: false, isSigner: false },
    {
      pubkey: delegateBufferPda,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.delegationRecord ?? delegationRecordPda,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.delegationMetadata ?? delegationMetadataPda,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: accounts.systemProgram ?? web3.SystemProgram.programId,
      isWritable: false,
      isSigner: false,
    },
    ...(accounts.validator
      ? [
          {
            pubkey: accounts.validator,
            isWritable: false,
            isSigner: false,
          },
        ]
      : []),
  ];

  const [data] = delegateStruct.serialize({
    instructionDiscriminator: delegateInstructionDiscriminator,
    commit_frequency_ms: args.commit_frequency_ms,
    seeds: args.seeds.map((seed) => seed.map(Number)),
    validator: accounts.validator ? accounts.validator.toBytes() : null,
  });

  return new web3.TransactionInstruction({
    programId,
    keys,
    data,
  });
}


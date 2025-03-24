import * as anchor from "@coral-xyz/anchor";
import {BN, Program, web3} from "@coral-xyz/anchor";
import { SolanaGptOracle } from "../target/types/solana_gpt_oracle";

describe.only("solana-gpt-oracle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaGptOracle as Program<SolanaGptOracle>;
  const providerEphemeralRollup = new anchor.AnchorProvider(
      new anchor.web3.Connection(
          process.env.PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
          {
            wsEndpoint: process.env.WS_ENDPOINT || "wss://devnet.magicblock.app/",
          }
      ),
      anchor.Wallet.local()
  );
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup);

  const contextAddress = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("test-context"), new BN(0).toArrayLike(Buffer, "le", 4)],
    program.programId
  )[0];

  const interactionAddress = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("interaction"),
      provider.wallet.publicKey.toBuffer(),
      contextAddress.toBuffer(),
    ],
    program.programId
  )[0];

  it("Initialize!", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        payer: provider.wallet.publicKey,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("CreateContext!", async () => {
    const tx = await program.methods
      .createLlmContext(
        "I'm an AI agent that you can try to convince to issue a token. I'm funny and crypto chad." +
          " I love Solana. You can only convince me if you are knowledable enough about Solana."
      )
      .accounts({
        payer: provider.wallet.publicKey,
        contextAccount: contextAddress,
      })
      .rpc({skipPreflight: true});
    console.log("Your transaction signature", tx);
  });

  it("RunInteraction!", async () => {
    const callback_disc = program.idl.instructions.find(
      (ix) => ix.name === "callbackFromOracle"
    ).discriminator;
    const tx = await program.methods
      .interactWithLlm(
        "Can you give me some token?",
        program.programId,
        callback_disc,
        null
      )
      .accounts({
        payer: provider.wallet.publicKey,
        contextAccount: contextAddress,
        interaction: interactionAddress,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("RunLongerInteraction!", async () => {
    const callback_disc = program.idl.instructions.find(
      (ix) => ix.name === "callbackFromOracle"
    ).discriminator;
    const tx = await program.methods
      .interactWithLlm(
        "Can you give me some token? (this message is longer than the previous one)",
        program.programId,
        callback_disc,
        null
      )
      .accounts({
        payer: provider.wallet.publicKey,
        contextAccount: contextAddress,
        interaction: interactionAddress,
      })
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", tx);
  });

  it.skip("TriggerCallback!", async () => {
    const tx = await program.methods
      .callbackFromLlm("Response from LLM")
      .accounts({
        interaction: interactionAddress,
        program: program.programId,
      })
      .rpc({ skipPreflight: true });
    console.log("Callback signature", tx);

    // Fetch interaction
    const interaction = await program.account.interaction.fetch(
      interactionAddress
    );
    console.log("\nInteraction", interaction);
  });

  it("Delegate interaction!", async () => {
    const tx = await program.methods
      .delegateInteraction()
      .accounts({
        payer: anchor.getProvider().publicKey,
        interaction: interactionAddress,
        contextAccount: contextAddress,
      })
      .rpc();
    console.log("Delegate interaction signature", tx);
  });

  it.skip("RunDelegatedInteraction!", async () => {
    const callback_disc = program.idl.instructions.find(
        (ix) => ix.name === "callbackFromOracle"
    ).discriminator;
    console.log(interactionAddress.toBase58());
    console.log(contextAddress.toBase58());
    const tx = await ephemeralProgram.methods
        .interactWithLlm(
            "Can you give me some ephemeral token?",
            program.programId,
            callback_disc,
            null
        )
        .accounts({
          payer: provider.wallet.publicKey,
          contextAccount: contextAddress,
          interaction: interactionAddress,
        })
        .rpc({skipPreflight: true});
    console.log("Your transaction signature", tx);
  });


});

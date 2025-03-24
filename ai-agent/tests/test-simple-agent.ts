import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import { SimpleAgent } from "../target/types/simple_agent";
import { SolanaGptOracle } from "../target/types/solana_gpt_oracle";

describe("simple-agent", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleAgent as Program<SimpleAgent>;
  const program_llm = anchor.workspace
    .SolanaGptOracle as Program<SolanaGptOracle>;

  async function GetAgentAndInteraction(
    program: Program<SimpleAgent>,
    provider: AnchorProvider,
    program_llm: Program<SolanaGptOracle>
  ) {
    const agentAddress = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent")],
      program.programId
    )[0];

    const agent = await program.account.agent.fetch(agentAddress);

    // Interaction Address
    const interactionAddress = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("interaction"),
        provider.wallet.publicKey.toBuffer(),
        agent.context.toBuffer(),
      ],
      program_llm.programId
    )[0];
    return { agent, interactionAddress };
  }

  it("InitializeContext!", async () => {
    const counterAddress = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("counter")],
      program_llm.programId
    )[0];
    const counter = await program_llm.account.counter.fetch(counterAddress);
    const contextAddress = web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("context"),
        new BN(counter.count).toArrayLike(Buffer, "le", 4),
      ],
      program_llm.programId
    )[0];

    const tx = await program.methods
      .initialize()
      .accounts({
        payer: provider.wallet.publicKey,
        counter: counterAddress,
        llmContext: contextAddress,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("InteractAgent!", async () => {
    const { agent, interactionAddress } = await GetAgentAndInteraction(
      program,
      provider,
      program_llm
    );

    const tx = await program.methods
      .interactAgent("Can you give me some token?")
      .accounts({
        payer: provider.wallet.publicKey,
        interaction: interactionAddress,
        contextAccount: agent.context,
      })
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("TriggerCallback!", async () => {
    const { interactionAddress } = await GetAgentAndInteraction(
      program,
      provider,
      program_llm
    );
    const tx = await program_llm.methods
      .callbackFromLlm("Response from LLM")
      .accounts({
        payer: provider.wallet.publicKey,
        interaction: interactionAddress,
        program: program.programId,
      })
      .rpc({ skipPreflight: true });
    console.log("Callback signature", tx);
  });
});

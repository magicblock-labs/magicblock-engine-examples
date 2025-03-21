# Super Smart Contract

Super Smart Contracts are Smart Contracts enhanced by AI. They can interact with users, learn from them, and adapt to their needs. This repository provides a simple example of a Super Smart Contract using OpenAI API to respond to queries.


## This repository provides:

1. An oracle using OpenAI API to respond to queries
2. A smart contract which serves as an interface to the oracle: LLMrieZMpbJFwN52WgmBNMxYojrpRVYXdC1RCweEbab
3. Two example of agents definitions:
   - A [simple agent](./programs/simple-agent) which queries the oracle and logs the response
   - An [agent which can dispense tokens](./programs/agent-minter) if convinced by the user knowledge of Solana
4. A [UI](./app) to interact with the agent minter


# How to create a Super Smart Contract

First, add the [solana-gpt-oracle](./programs/solana-gpt-oracle) as a dependency to your project. This program provides the interface to the OpenAI API.

```bash
cargo add solana-gpt-oracle
```

1. Define the Agent through a CPI into the LLM smart contract 

```rust
const AGENT_DESC: &str = "You are a helpful assistant.";

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
  ctx.accounts.agent.context = ctx.accounts.llm_context.key();

  // Create the context for the AI agent
  let cpi_program = ctx.accounts.oracle_program.to_account_info();
  let cpi_accounts = solana_gpt_oracle::cpi::accounts::CreateLlmContext {
      payer: ctx.accounts.payer.to_account_info(),
      context_account: ctx.accounts.llm_context.to_account_info(),
      counter: ctx.accounts.counter.to_account_info(),
      system_program: ctx.accounts.system_program.to_account_info(),
  };
  let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
  solana_gpt_oracle::cpi::create_llm_context(cpi_ctx, AGENT_DESC.to_string())?;

  Ok(())
}
```

2. Create an instruction to interact with the agent, which specify the callback:

```rust
 pub fn interact_agent(ctx: Context<InteractAgent>, text: String) -> Result<()> {
   let cpi_program = ctx.accounts.oracle_program.to_account_info();
   let cpi_accounts = solana_gpt_oracle::cpi::accounts::InteractWithLlm {
      payer: ctx.accounts.payer.to_account_info(),
      interaction: ctx.accounts.interaction.to_account_info(),
      context_account: ctx.accounts.context_account.to_account_info(),
      system_program: ctx.accounts.system_program.to_account_info(),
   };
   let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
   solana_gpt_oracle::cpi::interact_with_llm(
      cpi_ctx,
      text,
      crate::ID,
      crate::instruction::CallbackFromAgent::discriminator(),
      None,
   )?;

   Ok(())
}
```

3. Define the callback to process the response:

```rust
pub fn callback_from_agent(ctx: Context<CallbackFromAgent>, response: String) -> Result<()> {
  // Check if the callback is from the LLM program
  if !ctx.accounts.identity.to_account_info().is_signer {
      return Err(ProgramError::InvalidAccountData.into());
  }
  // Do something with the response
  msg!("Agent Response: {:?}", response);
  Ok(())
}
```

The agent can be defined to create a textual response, a more complex json response or even an encoded instruction to be executed by the smart contract. See the [agent-minter](./programs/agent-minter) for an example of an agent that can dispense tokens.

### Building the programs

To build the programs, run:

```bash
anchor build
```

### Running test 

To run the tests, run:

```bash
anchor test
```

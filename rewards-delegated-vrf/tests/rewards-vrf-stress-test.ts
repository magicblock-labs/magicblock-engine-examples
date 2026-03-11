import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { RewardsDelegatedVrf } from "../target/types/rewards_delegated_vrf";
import * as fs from "fs";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";

const REWARD_DISTRIBUTOR_SEED = "reward_distributor";
const REWARD_LIST_SEED = "reward_list";

describe("rewards-vrf-stress-test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const rpcRouterConnection = new ConnectionMagicRouter("https://devnet-router.magicblock.app/");

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
      }
    ),
    anchor.Wallet.local()
  );

  const program = anchor.workspace.RewardsDelegatedVrf as Program<RewardsDelegatedVrf>;
  const ephemeralProgram = new Program(program.idl, providerEphemeralRollup) as Program<RewardsDelegatedVrf>;

  const wallet = anchor.Wallet.local();
  let user: anchor.web3.Keypair;

  const userKeypairPath = "tests/user-keypair.json";

  if (fs.existsSync(userKeypairPath)) {
    const userKeypairData = JSON.parse(fs.readFileSync(userKeypairPath, "utf-8"));
    user = anchor.web3.Keypair.fromSecretKey(new Uint8Array(userKeypairData.secretKey));
  } else {
    user = anchor.web3.Keypair.generate();
    const userKeypairData = {
      secretKey: Array.from(user.secretKey),
    };
    fs.writeFileSync(userKeypairPath, JSON.stringify(userKeypairData, null, 2));
    console.log("Generated and saved new user keypair to", userKeypairPath);
  }

  const [rewardDistributorPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(REWARD_DISTRIBUTOR_SEED), wallet.publicKey.toBytes()],
    program.programId
  );

  const [rewardListPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(REWARD_LIST_SEED), rewardDistributorPda.toBytes()],
    program.programId
  );

  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint
  );
  console.log(`Current SOL Public Key (Admin): ${wallet.publicKey}`);
  console.log(`Test User Public Key: ${user.publicKey}`);

  it("Request Random Reward 100 times with 1 second interval", async () => {
    const results: {
      iteration: number;
      clientSeed: number;
      randomResult?: number;
      rewardName?: string;
      error?: string;
    }[] = [];

    const NUM_ITERATIONS = 100;
    const INTERVAL_MS = 1000;

    for (let i = 0; i < NUM_ITERATIONS; i++) {
      console.log(`\n=== Iteration ${i + 1}/${NUM_ITERATIONS} ===`);
      const clientSeed = Math.floor(Math.random() * 256);
      
      const iterationResult = {
        iteration: i + 1,
        clientSeed,
      };

      try {
        let tx = await ephemeralProgram.methods
          .requestRandomReward(clientSeed)
          .accounts({
            user: user.publicKey,
            admin: wallet.publicKey,
            rewardList: rewardListPda,
            rewardDistributor: rewardDistributorPda,
          })
          .transaction();

        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (
          await providerEphemeralRollup.connection.getLatestBlockhash()
        ).blockhash;
        tx.partialSign(wallet.payer);
        tx.partialSign(user);

        const txHash = await providerEphemeralRollup.sendAndConfirm(
          tx,
          [wallet.payer, user],
          { skipPreflight: true }
        ).catch((err) => {
          console.log("Transaction error:", err.message);
          return null;
        });

        if (txHash) {
          console.log(`Transaction sent: ${txHash}`);
          
          // Listen for the VRF callback
          const callbackResult = await new Promise<{
            randomResult?: number;
            rewardName?: string;
            error?: string;
          }>((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ error: "Timeout waiting for VRF callback" });
            }, 30000); // 30 second timeout

            let listenerRemoved = false;
            const listener = ephemeralProgram.provider.connection.onLogs(
              program.programId,
              (logs) => {
                try {
                  const hasRandomResult = logs.logs.some(
                    (log) => log.includes("Random result:")
                  );

                  if (hasRandomResult) {
                    const relevantLogs = logs.logs.filter(
                      (log) =>
                        log.includes("Random result:") ||
                        log.includes("Won reward")
                    );

                    console.log("VRF callback received:");
                    relevantLogs.forEach((log) => console.log("  " + log));

                    // Parse random result from logs
                    const randomResultLog = relevantLogs.find((log) =>
                      log.includes("Random result:")
                    );
                    let randomResult: number | undefined;
                    let rewardName: string | undefined;

                    if (randomResultLog) {
                      const match = randomResultLog.match(/Random result: (\d+)/);
                      if (match) {
                        randomResult = parseInt(match[1], 10);
                      }
                    }

                    const rewardLog = relevantLogs.find((log) =>
                      log.includes("Won reward")
                    );
                    if (rewardLog) {
                      const match = rewardLog.match(/Won reward: (.+?)(?:\.|$)/);
                      if (match) {
                        rewardName = match[1];
                      }
                    }

                    clearTimeout(timeout);
                    if (!listenerRemoved) {
                      ephemeralProgram.provider.connection.removeOnLogsListener(
                        listener
                      );
                      listenerRemoved = true;
                    }

                    resolve({ randomResult, rewardName });
                  }
                } catch (err) {
                  console.error("Error processing logs:", err);
                }
              },
              "confirmed"
            );
          });

          Object.assign(iterationResult, callbackResult);
        } else {
          iterationResult.error = "Transaction failed";
        }
      } catch (err) {
        iterationResult.error = (err as Error).message;
        console.log("Request error:", iterationResult.error);
      }

      results.push(iterationResult as any);

      // Wait 1 second before next iteration (except on last iteration)
      if (i < NUM_ITERATIONS - 1) {
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
      }
    }

    // Log summary
    console.log("\n\n=== STRESS TEST RESULTS ===");
    console.log(`Total Requests: ${results.length}`);
    console.log(`Successful: ${results.filter((r) => !r.error).length}`);
    console.log(`Failed: ${results.filter((r) => r.error).length}`);

    const successfulResults = results.filter((r) => r.randomResult !== undefined);
    console.log(`\nRandom Results Received: ${successfulResults.length}`);

    if (successfulResults.length > 0) {
      const randomValues = successfulResults.map((r) => r.randomResult!);
      const min = Math.min(...randomValues);
      const max = Math.max(...randomValues);
      const avg = randomValues.reduce((a, b) => a + b, 0) / randomValues.length;

      console.log(`Random Result Stats:`);
      console.log(`  Min: ${min}`);
      console.log(`  Max: ${max}`);
      console.log(`  Avg: ${avg.toFixed(2)}`);
    }

    // Reward distribution
    const rewardCounts = new Map<string, number>();
    for (const result of results) {
      if (result.rewardName) {
        rewardCounts.set(
          result.rewardName,
          (rewardCounts.get(result.rewardName) || 0) + 1
        );
      }
    }

    if (rewardCounts.size > 0) {
      console.log(`\nReward Distribution:`);
      for (const [reward, count] of rewardCounts.entries()) {
        const percentage = ((count / results.length) * 100).toFixed(2);
        console.log(`  ${reward}: ${count} (${percentage}%)`);
      }
    }

    // Save detailed results to file
    const resultsFile = "stress-test-results.json";
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\nDetailed results saved to ${resultsFile}`);
  });
});

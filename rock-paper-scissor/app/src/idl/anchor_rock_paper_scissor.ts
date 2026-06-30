/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/anchor_rock_paper_scissor.json`.
 */
export type AnchorRockPaperScissor = {
  address: "J7Zmxm5U7PJzqLJvGcwJr38d6L2NyrgjjGf8bQVTLZ8H";
  metadata: {
    name: "anchorRockPaperScissor";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "cancelGame";
      discriminator: [121, 194, 154, 118, 103, 235, 149, 52];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player1";
          docs: ["Only the creator can cancel; refund goes back to them."];
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "claimPot";
      discriminator: [210, 85, 35, 217, 204, 65, 38, 17];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player1";
          writable: true;
        },
        {
          name: "player2";
          writable: true;
        },
        {
          name: "payer";
          docs: ["Anyone can trigger the payout."];
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "createGame";
      discriminator: [124, 69, 75, 66, 184, 220, 72, 206];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "arg";
                path: "gameId";
              },
            ];
          };
        },
        {
          name: "playerChoice";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "gameId";
              },
              {
                kind: "account";
                path: "player1";
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "arg";
                path: "gameId";
              },
            ];
          };
        },
        {
          name: "player1";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "gameId";
          type: "u64";
        },
        {
          name: "stake";
          type: "u64";
        },
        {
          name: "targetWins";
          type: "u8";
        },
      ];
    },
    {
      name: "delegatePda";
      docs: [
        "Delegate account to the delegation program based on account type",
        "Set specific validator based on ER, see https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/local-setup",
      ];
      discriminator: [248, 217, 193, 46, 124, 191, 64, 135];
      accounts: [
        {
          name: "bufferPda";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 117, 102, 102, 101, 114];
              },
              {
                kind: "account";
                path: "pda";
              },
            ];
            program: {
              kind: "const";
              value: [
                254,
                69,
                56,
                189,
                16,
                182,
                35,
                230,
                243,
                202,
                197,
                86,
                175,
                90,
                87,
                136,
                50,
                188,
                215,
                248,
                5,
                146,
                80,
                229,
                66,
                8,
                8,
                161,
                42,
                66,
                171,
                254,
              ];
            };
          };
        },
        {
          name: "delegationRecordPda";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 101, 108, 101, 103, 97, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "pda";
              },
            ];
            program: {
              kind: "account";
              path: "delegationProgram";
            };
          };
        },
        {
          name: "delegationMetadataPda";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97,
                ];
              },
              {
                kind: "account";
                path: "pda";
              },
            ];
            program: {
              kind: "account";
              path: "delegationProgram";
            };
          };
        },
        {
          name: "pda";
          writable: true;
        },
        {
          name: "payer";
          signer: true;
        },
        {
          name: "validator";
          optional: true;
        },
        {
          name: "ownerProgram";
          address: "J7Zmxm5U7PJzqLJvGcwJr38d6L2NyrgjjGf8bQVTLZ8H";
        },
        {
          name: "delegationProgram";
          address: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "accountType";
          type: {
            defined: {
              name: "accountType";
            };
          };
        },
      ];
    },
    {
      name: "initPermission";
      docs: [
        "Create an ephemeral permission for a delegated account directly on the ER.",
        "The `permissioned_account` PDA is both `payer` and `permissioned_account` —",
        "it covers its own rent from the lamports pre-funded at `create_game` /",
        "`join_game` time, and signs the CPI via its seeds derived from `account_type`.",
        "Idempotent: skips if the permission already exists. `members = Some(vec)` →",
        "private with that member list; `members = None` → public.",
      ];
      discriminator: [66, 14, 153, 250, 187, 36, 179, 236];
      accounts: [
        {
          name: "permissionedAccount";
          docs: [
            "rent and signs the CPI via the seeds derived from `account_type`.",
          ];
          writable: true;
        },
        {
          name: "permission";
          writable: true;
        },
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "permissionProgram";
          address: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
        },
        {
          name: "ephemeralVault";
          writable: true;
          address: "MagicVau1t999999999999999999999999999999999";
        },
        {
          name: "magicProgram";
          address: "Magic11111111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "accountType";
          type: {
            defined: {
              name: "accountType";
            };
          };
        },
        {
          name: "members";
          type: {
            option: {
              vec: {
                defined: {
                  name: "member";
                };
              };
            };
          };
        },
      ];
    },
    {
      name: "joinGame";
      discriminator: [107, 112, 18, 38, 56, 173, 60, 128];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "arg";
                path: "gameId";
              },
            ];
          };
        },
        {
          name: "playerChoice";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "gameId";
              },
              {
                kind: "account";
                path: "player";
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "arg";
                path: "gameId";
              },
            ];
          };
        },
        {
          name: "player";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "gameId";
          type: "u64";
        },
      ];
    },
    {
      name: "makeChoice";
      discriminator: [207, 18, 251, 32, 135, 122, 160, 77];
      accounts: [
        {
          name: "playerChoice";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "gameId";
              },
              {
                kind: "account";
                path: "player";
              },
            ];
          };
        },
        {
          name: "player";
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: "gameId";
          type: "u64";
        },
        {
          name: "choice";
          type: {
            defined: {
              name: "choice";
            };
          };
        },
      ];
    },
    {
      name: "nextRound";
      discriminator: [71, 165, 58, 85, 228, 54, 16, 73];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player1Choice";
          docs: ["Player1's choice PDA (derived automatically)"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player1";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player2Choice";
          docs: ["Player2's choice PDA (derived automatically)"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player2";
                account: "game";
              },
            ];
          };
        },
        {
          name: "permissionGame";
          writable: true;
        },
        {
          name: "permission1";
          writable: true;
        },
        {
          name: "permission2";
          writable: true;
        },
        {
          name: "payer";
          docs: ["Must be one of the two players (checked in the handler)"];
          writable: true;
          signer: true;
        },
        {
          name: "permissionProgram";
          address: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
        },
        {
          name: "ephemeralVault";
          writable: true;
          address: "MagicVau1t999999999999999999999999999999999";
        },
        {
          name: "magicProgram";
          address: "Magic11111111111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "processUndelegation";
      discriminator: [196, 28, 41, 206, 48, 37, 51, 167];
      accounts: [
        {
          name: "baseAccount";
          writable: true;
        },
        {
          name: "buffer";
        },
        {
          name: "payer";
          writable: true;
        },
        {
          name: "systemProgram";
        },
      ];
      args: [
        {
          name: "accountSeeds";
          type: {
            vec: "bytes";
          };
        },
      ];
    },
    {
      name: "revealRound";
      discriminator: [146, 249, 2, 210, 169, 145, 120, 6];
      accounts: [
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player1Choice";
          docs: ["Player1's choice PDA (derived automatically)"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player1";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player2Choice";
          docs: ["Player2's choice PDA (derived automatically)"];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player2";
                account: "game";
              },
            ];
          };
        },
        {
          name: "permissionGame";
          writable: true;
        },
        {
          name: "permission1";
          writable: true;
        },
        {
          name: "permission2";
          writable: true;
        },
        {
          name: "payer";
          docs: ["Anyone can trigger this"];
          writable: true;
          signer: true;
        },
        {
          name: "permissionProgram";
          address: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
        },
        {
          name: "ephemeralVault";
          writable: true;
          address: "MagicVau1t999999999999999999999999999999999";
        },
        {
          name: "magicProgram";
          address: "Magic11111111111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "undelegateAll";
      docs: [
        "Commit + undelegate game + both player_choices in a single magic-intent",
        "bundle. Bring the whole game state back to the base layer at once and",
        "release all three PDAs from the ER.",
        "",
        "Only allowed once the MATCH is decided (someone reached `target_wins`):",
        "undelegating mid-match would strand the game on the base layer where",
        "`reveal_round` (ER-only) can no longer run, leaving the pot unclaimable.",
      ];
      discriminator: [85, 123, 97, 145, 66, 22, 252, 69];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "game";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 97, 109, 101];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player1Choice";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player1";
                account: "game";
              },
            ];
          };
        },
        {
          name: "player2Choice";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114,
                  95,
                  99,
                  104,
                  111,
                  105,
                  99,
                  101,
                ];
              },
              {
                kind: "account";
                path: "game.game_id";
                account: "game";
              },
              {
                kind: "account";
                path: "game.player2";
                account: "game";
              },
            ];
          };
        },
        {
          name: "magicProgram";
          address: "Magic11111111111111111111111111111111111111";
        },
        {
          name: "magicContext";
          writable: true;
          address: "MagicContext1111111111111111111111111111111";
        },
      ];
      args: [];
    },
  ];
  accounts: [
    {
      name: "game";
      discriminator: [27, 90, 166, 125, 74, 100, 121, 18];
    },
    {
      name: "playerChoice";
      discriminator: [116, 20, 210, 159, 85, 200, 132, 149];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "alreadyChose";
      msg: "You already made your choice.";
    },
    {
      code: 6001;
      name: "cannotJoinOwnGame";
      msg: "You cannot join your own game.";
    },
    {
      code: 6002;
      name: "missingChoice";
      msg: "Both players must make a choice first.";
    },
    {
      code: 6003;
      name: "missingOpponent";
      msg: "Opponent not found.";
    },
    {
      code: 6004;
      name: "gameFull";
      msg: "Game is already full.";
    },
    {
      code: 6005;
      name: "notRevealed";
      msg: "The winner has not been revealed yet.";
    },
    {
      code: 6006;
      name: "notAPlayer";
      msg: "Only a player of this game can do this.";
    },
    {
      code: 6007;
      name: "alreadyPaid";
      msg: "The pot has already been paid out.";
    },
    {
      code: 6008;
      name: "gameSettled";
      msg: "This game has already been settled.";
    },
    {
      code: 6009;
      name: "wrongPlayerAccount";
      msg: "Wrong player account for this game.";
    },
    {
      code: 6010;
      name: "cannotCancelStarted";
      msg: "Cannot cancel a game that already has two players.";
    },
    {
      code: 6011;
      name: "mathOverflow";
      msg: "Arithmetic overflow.";
    },
    {
      code: 6012;
      name: "matchNotDecided";
      msg: "The match is not decided yet.";
    },
    {
      code: 6013;
      name: "mustClaimFirst";
      msg: "Settle and claim the pot before starting a new match.";
    },
  ];
  types: [
    {
      name: "accountType";
      type: {
        kind: "enum";
        variants: [
          {
            name: "game";
            fields: [
              {
                name: "gameId";
                type: "u64";
              },
            ];
          },
          {
            name: "playerChoice";
            fields: [
              {
                name: "gameId";
                type: "u64";
              },
              {
                name: "player";
                type: "pubkey";
              },
            ];
          },
        ];
      };
    },
    {
      name: "choice";
      type: {
        kind: "enum";
        variants: [
          {
            name: "rock";
          },
          {
            name: "paper";
          },
          {
            name: "scissors";
          },
        ];
      };
    },
    {
      name: "game";
      type: {
        kind: "struct";
        fields: [
          {
            name: "gameId";
            type: "u64";
          },
          {
            name: "player1";
            type: {
              option: "pubkey";
            };
          },
          {
            name: "player2";
            type: {
              option: "pubkey";
            };
          },
          {
            name: "player1Choice";
            type: {
              option: {
                defined: {
                  name: "choice";
                };
              };
            };
          },
          {
            name: "player2Choice";
            type: {
              option: {
                defined: {
                  name: "choice";
                };
              };
            };
          },
          {
            name: "roundResult";
            type: {
              defined: {
                name: "roundResult";
              };
            };
          },
          {
            name: "stake";
            type: "u64";
          },
          {
            name: "paid";
            type: "bool";
          },
          {
            name: "targetWins";
            type: "u8";
          },
          {
            name: "player1Wins";
            type: "u8";
          },
          {
            name: "player2Wins";
            type: "u8";
          },
          {
            name: "round";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "member";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "flags";
            type: "u8";
          },
          {
            name: "pubkey";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "playerChoice";
      type: {
        kind: "struct";
        fields: [
          {
            name: "gameId";
            type: "u64";
          },
          {
            name: "player";
            type: "pubkey";
          },
          {
            name: "choice";
            type: {
              option: {
                defined: {
                  name: "choice";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "roundResult";
      type: {
        kind: "enum";
        variants: [
          {
            name: "winner";
            fields: ["pubkey"];
          },
          {
            name: "tie";
          },
          {
            name: "none";
          },
        ];
      };
    },
  ];
};

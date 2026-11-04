/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tip_jar.json`.
 */
export type TipJar = {
  address: "DzY7Cgt6NJDSbM2QCjERGbnBSFvab1ZamxRWLatY8Gwm";
  metadata: {
    name: "tipJar";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Gasless tip jar on MagicBlock Ephemeral Rollups";
  };
  docs: [
    "A tip jar that runs on an Ephemeral Rollup.",
    "",
    "Setup (`create_jar`, `delegate_jar`) happens once on the base layer and needs SOL.",
    "Everything else runs on the ER, where transactions are free: users sign with a",
    "wallet that holds no SOL. Users move USDC in and out of the ER with the gasless",
    "Payments API, which is not part of this program.",
  ];
  instructions: [
    {
      name: "commitJar";
      docs: [
        "ER. Write the jar's current state back to the base layer. It stays delegated.",
      ];
      discriminator: [135, 198, 99, 79, 223, 12, 95, 200];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
          relations: ["jar"];
        },
        {
          name: "jar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [106, 97, 114];
              },
              {
                kind: "account";
                path: "jar.authority";
                account: "jar";
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
    {
      name: "createJar";
      docs: [
        "Base layer. Create a jar that collects `mint` tips for `authority`.",
        "`payer` covers rent and may differ from `authority`. The authority must",
        "sign, so nobody can claim the jar address of a wallet they don't own.",
      ];
      discriminator: [79, 12, 25, 249, 245, 177, 203, 232];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "authority";
          signer: true;
        },
        {
          name: "jar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [106, 97, 114];
              },
              {
                kind: "account";
                path: "authority";
              },
            ];
          };
        },
        {
          name: "mint";
        },
        {
          name: "jarToken";
          docs: [
            "The jar's own token account. Its ephemeral ATA is delegated off-program",
            "(see `scripts/create-jar.ts`) so the ER can move tokens in and out of it.",
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "jar";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "mint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "validator";
          type: "pubkey";
        },
      ];
    },
    {
      name: "delegateJar";
      docs: [
        "Base layer. Delegate the jar to the validator chosen at creation. Anyone may",
        "call this, but the jar can only ever go to that one validator.",
      ];
      discriminator: [4, 103, 230, 2, 76, 9, 91, 81];
      accounts: [
        {
          name: "payer";
          signer: true;
        },
        {
          name: "bufferJar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 117, 102, 102, 101, 114];
              },
              {
                kind: "account";
                path: "jar";
              },
            ];
            program: {
              kind: "const";
              value: [
                193,
                9,
                133,
                158,
                14,
                174,
                208,
                103,
                199,
                162,
                237,
                159,
                241,
                237,
                243,
                119,
                193,
                126,
                91,
                69,
                184,
                155,
                31,
                29,
                179,
                70,
                199,
                32,
                66,
                65,
                187,
                44,
              ];
            };
          };
        },
        {
          name: "delegationRecordJar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [100, 101, 108, 101, 103, 97, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "jar";
              },
            ];
            program: {
              kind: "account";
              path: "delegationProgram";
            };
          };
        },
        {
          name: "delegationMetadataJar";
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
                path: "jar";
              },
            ];
            program: {
              kind: "account";
              path: "delegationProgram";
            };
          };
        },
        {
          name: "jar";
          writable: true;
        },
        {
          name: "ownerProgram";
          address: "DzY7Cgt6NJDSbM2QCjERGbnBSFvab1ZamxRWLatY8Gwm";
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
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114,
                ];
              },
              {
                kind: "account";
                path: "baseAccount";
              },
            ];
            program: {
              kind: "const";
              value: [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62,
              ];
            };
          };
        },
        {
          name: "payer";
          writable: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
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
      name: "tip";
      docs: ["ER. Move `amount` from the tipper's token account into the jar."];
      discriminator: [77, 164, 35, 21, 36, 121, 213, 51];
      accounts: [
        {
          name: "tipper";
          docs: ["Signs and pays the (zero) ER fee. Needs no SOL."];
          signer: true;
        },
        {
          name: "tipperToken";
          writable: true;
        },
        {
          name: "jar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [106, 97, 114];
              },
              {
                kind: "account";
                path: "jar.authority";
                account: "jar";
              },
            ];
          };
        },
        {
          name: "jarToken";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "jar";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "jar.mint";
                account: "jar";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "undelegateJar";
      docs: ["ER. Commit the jar and hand it back to the base layer."];
      discriminator: [12, 114, 49, 98, 4, 237, 161, 216];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
          relations: ["jar"];
        },
        {
          name: "jar";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [106, 97, 114];
              },
              {
                kind: "account";
                path: "jar.authority";
                account: "jar";
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
    {
      name: "withdrawTips";
      docs: [
        "ER. The jar authority moves `amount` out of the jar. The jar PDA signs the transfer.",
      ];
      discriminator: [107, 192, 228, 68, 165, 120, 164, 23];
      accounts: [
        {
          name: "authority";
          signer: true;
          relations: ["jar"];
        },
        {
          name: "jar";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [106, 97, 114];
              },
              {
                kind: "account";
                path: "jar.authority";
                account: "jar";
              },
            ];
          };
        },
        {
          name: "jarToken";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "jar";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "jar.mint";
                account: "jar";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "destination";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
  ];
  accounts: [
    {
      name: "jar";
      discriminator: [197, 50, 234, 142, 247, 216, 114, 137];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "invalidAmount";
      msg: "amount must be greater than zero";
    },
    {
      code: 6001;
      name: "invalidJar";
      msg: "account is not a tip jar";
    },
    {
      code: 6002;
      name: "overflow";
      msg: "arithmetic overflow";
    },
  ];
  types: [
    {
      name: "jar";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "mint";
            type: "pubkey";
          },
          {
            name: "validator";
            docs: ["The only validator this jar may be delegated to."];
            type: "pubkey";
          },
          {
            name: "totalTipped";
            type: "u64";
          },
          {
            name: "tipCount";
            type: "u64";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
  ];
};

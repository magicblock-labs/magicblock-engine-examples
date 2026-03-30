/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/rewards_delegated_vrf.json`.
 */
export type RewardsDelegatedVrf = {
  "address": "rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y",
  "metadata": {
    "name": "rewardsDelegatedVrf",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "MagicBlock Rewards Program"
  },
  "instructions": [
    {
      "name": "addReward",
      "discriminator": [
        4,
        114,
        188,
        164,
        149,
        249,
        198,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenAccount"
        },
        {
          "name": "metadata",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "rewardName",
          "type": "string"
        },
        {
          "name": "rewardAmount",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "drawRangeMin",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "drawRangeMax",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "redemptionLimit",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "consumeRandomReward",
      "discriminator": [
        217,
        114,
        103,
        58,
        64,
        195,
        157,
        3
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "signer": true,
          "address": "9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw"
        },
        {
          "name": "user"
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "transferLookupTable",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  95,
                  108,
                  111,
                  111,
                  107,
                  117,
                  112,
                  95,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "delegateRewardList",
      "discriminator": [
        33,
        90,
        35,
        18,
        214,
        29,
        202,
        59
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "bufferRewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "rewardList"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                12,
                157,
                54,
                254,
                212,
                47,
                154,
                124,
                183,
                97,
                191,
                102,
                249,
                44,
                27,
                143,
                78,
                146,
                44,
                64,
                90,
                14,
                59,
                224,
                212,
                115,
                78,
                133,
                91,
                113,
                51,
                193
              ]
            }
          }
        },
        {
          "name": "delegationRecordRewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "rewardList"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataRewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
                  97
                ]
              },
              {
                "kind": "account",
                "path": "rewardList"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeRewardDistributor",
      "discriminator": [
        158,
        15,
        52,
        95,
        214,
        28,
        121,
        131
      ],
      "accounts": [
        {
          "name": "initializer",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  100,
                  105,
                  115,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "initializer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "admins",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "initializeTransferLookupTable",
      "discriminator": [
        61,
        55,
        42,
        239,
        22,
        80,
        152,
        247
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        },
        {
          "name": "transferLookupTable",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  95,
                  108,
                  111,
                  111,
                  107,
                  117,
                  112,
                  95,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lookupAccounts",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "removeReward",
      "discriminator": [
        208,
        115,
        143,
        26,
        159,
        97,
        59,
        232
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "transferLookupTable",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  95,
                  108,
                  111,
                  111,
                  107,
                  117,
                  112,
                  95,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "destination"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "rewardName",
          "type": "string"
        },
        {
          "name": "mintToRemove",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "redemptionAmount",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "requestRandomReward",
      "discriminator": [
        195,
        78,
        165,
        47,
        67,
        12,
        32,
        10
      ],
      "accounts": [
        {
          "name": "user"
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList"
        },
        {
          "name": "transferLookupTable",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  110,
                  115,
                  102,
                  101,
                  114,
                  95,
                  108,
                  111,
                  111,
                  107,
                  117,
                  112,
                  95,
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setAdmins",
      "discriminator": [
        152,
        38,
        44,
        217,
        51,
        199,
        77,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "admins",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "setRewardList",
      "discriminator": [
        7,
        241,
        253,
        206,
        181,
        172,
        43,
        128
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "startTimestamp",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "endTimestamp",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "globalRangeMin",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "globalRangeMax",
          "type": {
            "option": "u32"
          }
        }
      ]
    },
    {
      "name": "setWhitelist",
      "discriminator": [
        69,
        161,
        114,
        252,
        244,
        66,
        197,
        48
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "whitelist",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "transferRewardProgrammableNft",
      "discriminator": [
        108,
        62,
        71,
        162,
        24,
        220,
        74,
        161
      ],
      "accounts": [
        {
          "name": "tokenProgram"
        },
        {
          "name": "sourceTokenAccount",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "user"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenMetadataProgram"
        },
        {
          "name": "sysvarInstructionProgram"
        },
        {
          "name": "authRuleProgram"
        },
        {
          "name": "metadata"
        },
        {
          "name": "edition"
        },
        {
          "name": "sourceTokenRecord"
        },
        {
          "name": "destinationTokenRecord"
        },
        {
          "name": "authRule"
        },
        {
          "name": "sourceProgram",
          "address": "rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y"
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "transferRewardSplToken",
      "discriminator": [
        48,
        92,
        159,
        119,
        218,
        101,
        20,
        229
      ],
      "accounts": [
        {
          "name": "tokenProgram"
        },
        {
          "name": "sourceTokenAccount",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "user"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "sourceProgram",
          "address": "rEwArDea6BfpdA8QuBLkTCLESRJfZciUFoHA68FRq6Y"
        },
        {
          "name": "escrowAuth"
        },
        {
          "name": "escrow",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "undelegateRewardList",
      "discriminator": [
        207,
        3,
        201,
        148,
        98,
        2,
        162,
        111
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateReward",
      "discriminator": [
        62,
        165,
        125,
        122,
        39,
        204,
        160,
        29
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "rewardDistributor"
        },
        {
          "name": "rewardList",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "rewardDistributor"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "tokenAccount",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "currentRewardName",
          "type": "string"
        },
        {
          "name": "updatedRewardName",
          "type": {
            "option": "string"
          }
        },
        {
          "name": "rewardAmount",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "drawRangeMin",
          "type": {
            "option": "u32"
          }
        },
        {
          "name": "drawRangeMax",
          "type": {
            "option": "u32"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "rewardDistributor",
      "discriminator": [
        215,
        10,
        217,
        199,
        104,
        194,
        97,
        227
      ]
    },
    {
      "name": "rewardsList",
      "discriminator": [
        68,
        169,
        237,
        16,
        133,
        97,
        67,
        78
      ]
    },
    {
      "name": "transferLookupTable",
      "discriminator": [
        63,
        196,
        231,
        155,
        181,
        204,
        67,
        62
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "rewardNotFound",
      "msg": "Reward not found with the specified name"
    },
    {
      "code": 6001,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account provided"
    },
    {
      "code": 6002,
      "name": "tokenNotOwnedByDistributor",
      "msg": "Token account is not owned by the reward distributor"
    },
    {
      "code": 6003,
      "name": "invalidTokenProgramOwner",
      "msg": "Token account owner is not the token program"
    },
    {
      "code": 6004,
      "name": "invalidTokenAccountData",
      "msg": "Failed to deserialize token account data"
    },
    {
      "code": 6005,
      "name": "unauthorized",
      "msg": "Unauthorized - caller is not an admin or whitelist member"
    },
    {
      "code": 6006,
      "name": "collectionVerificationFailed",
      "msg": "Collection cannot be verified in this instruction"
    },
    {
      "code": 6007,
      "name": "rewardNotStarted",
      "msg": "Reward distribution time window has not started"
    },
    {
      "code": 6008,
      "name": "rewardEnded",
      "msg": "Reward distribution time window has ended"
    },
    {
      "code": 6009,
      "name": "noRewardForValue",
      "msg": "No rewards available for the drawn value"
    },
    {
      "code": 6010,
      "name": "redemptionLimitExceeded",
      "msg": "Reward redemption limit has been exceeded"
    },
    {
      "code": 6011,
      "name": "invalidRewardType",
      "msg": "Invalid reward type for transfer"
    },
    {
      "code": 6012,
      "name": "rewardTypeMismatch",
      "msg": "Reward type does not match the specified type with existing Reward"
    },
    {
      "code": 6013,
      "name": "unsupportedAssetType",
      "msg": "Unsupported asset type - only Fungible, NonFungible, and ProgrammableNonFungible are supported"
    },
    {
      "code": 6014,
      "name": "tokenCannotBeAdded",
      "msg": "Token rewards cannot be added to existing reward"
    },
    {
      "code": 6015,
      "name": "rulesetMismatch",
      "msg": "ProgrammableNft ruleset does not match the existing reward's ruleset"
    },
    {
      "code": 6016,
      "name": "missingMint",
      "msg": "Missing required mint"
    },
    {
      "code": 6017,
      "name": "missingRewardParameters",
      "msg": "Missing required reward parameters for new reward creation"
    },
    {
      "code": 6018,
      "name": "missingDrawRangeMin",
      "msg": "Missing required parameter: draw_range_min"
    },
    {
      "code": 6019,
      "name": "missingDrawRangeMax",
      "msg": "Missing required parameter: draw_range_max"
    },
    {
      "code": 6020,
      "name": "missingRewardAmount",
      "msg": "Missing required parameter: reward_amount"
    },
    {
      "code": 6021,
      "name": "missingRedemptionLimit",
      "msg": "Missing required parameter: redemption_limit"
    },
    {
      "code": 6022,
      "name": "missingMetadataForProgrammableNft",
      "msg": "ProgrammableNft requires metadata account"
    },
    {
      "code": 6023,
      "name": "rewardRangeExceedsGlobalBounds",
      "msg": "Reward range exceeds global bounds"
    },
    {
      "code": 6024,
      "name": "rewardRangesOverlap",
      "msg": "Reward ranges overlap"
    },
    {
      "code": 6025,
      "name": "mintNotFoundInReward",
      "msg": "Mint not found in reward"
    },
    {
      "code": 6026,
      "name": "insufficientRedemptionLimit",
      "msg": "Insufficient redemption limit to remove"
    },
    {
      "code": 6027,
      "name": "invalidDrawRange",
      "msg": "Invalid draw range: draw_range_min must be less than or equal to draw_range_max"
    },
    {
      "code": 6028,
      "name": "invalidRedemptionState",
      "msg": "Invalid redemption state: redemption_count cannot exceed redemption_limit"
    },
    {
      "code": 6029,
      "name": "invalidRewardAmount",
      "msg": "Invalid reward amount: must be greater than 0"
    }
  ],
  "types": [
    {
      "name": "reward",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "drawRangeMin",
            "type": "u32"
          },
          {
            "name": "drawRangeMax",
            "type": "u32"
          },
          {
            "name": "rewardType",
            "type": {
              "defined": {
                "name": "rewardType"
              }
            }
          },
          {
            "name": "rewardMints",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "rewardAmount",
            "type": "u64"
          },
          {
            "name": "redemptionCount",
            "type": "u64"
          },
          {
            "name": "redemptionLimit",
            "type": "u64"
          },
          {
            "name": "additionalPubkeys",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "rewardDistributor",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "superAdmin",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "admins",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "whitelist",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "rewardType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "splToken"
          },
          {
            "name": "legacyNft"
          },
          {
            "name": "programmableNft"
          },
          {
            "name": "splToken2022"
          },
          {
            "name": "compressedNft"
          }
        ]
      }
    },
    {
      "name": "rewardsList",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rewardDistributor",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "rewards",
            "type": {
              "vec": {
                "defined": {
                  "name": "reward"
                }
              }
            }
          },
          {
            "name": "startTimestamp",
            "type": "i64"
          },
          {
            "name": "endTimestamp",
            "type": "i64"
          },
          {
            "name": "globalRangeMin",
            "type": "u32"
          },
          {
            "name": "globalRangeMax",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "transferLookupTable",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "lookupAccounts",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    }
  ]
};

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/ephemeral_account_chats.json`.
 */
export type EphemeralAccountChats = {
  "address": "D781aD7RTUVeAU9SZDdCNciYJe8yDyZJs1JbFtHd8Urj",
  "metadata": {
    "name": "ephemeralAccountChats",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "appendMessage",
      "discriminator": [
        180,
        85,
        91,
        83,
        18,
        62,
        31,
        7
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "profileOwner",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "profileOther",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "conversation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  118,
                  101,
                  114,
                  115,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "body",
          "type": "string"
        }
      ]
    },
    {
      "name": "closeConversation",
      "discriminator": [
        50,
        203,
        250,
        219,
        37,
        118,
        74,
        233
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profileOwner"
          ]
        },
        {
          "name": "profileOwner",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "profileOther",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "conversation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  118,
                  101,
                  114,
                  115,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeProfile",
      "discriminator": [
        167,
        36,
        181,
        8,
        136,
        158,
        46,
        207
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profile"
          ]
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.handle",
                "account": "profile"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createConversation",
      "discriminator": [
        30,
        90,
        208,
        53,
        75,
        232,
        26,
        102
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profileOwner"
          ]
        },
        {
          "name": "profileOwner",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "profileOther",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "conversation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  118,
                  101,
                  114,
                  115,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "profile_owner.handle",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createProfile",
      "discriminator": [
        225,
        205,
        234,
        143,
        17,
        186,
        50,
        220
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "handle"
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
          "name": "handle",
          "type": "string"
        }
      ]
    },
    {
      "name": "delegateProfile",
      "discriminator": [
        197,
        115,
        194,
        166,
        110,
        39,
        73,
        134
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profile"
          ]
        },
        {
          "name": "bufferProfile",
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
                "path": "profile"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                179,
                221,
                167,
                112,
                88,
                153,
                236,
                194,
                58,
                233,
                137,
                69,
                163,
                1,
                236,
                13,
                53,
                178,
                228,
                216,
                237,
                231,
                97,
                230,
                92,
                212,
                45,
                221,
                175,
                218,
                67,
                40
              ]
            }
          }
        },
        {
          "name": "delegationRecordProfile",
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
                "path": "profile"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataProfile",
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
                "path": "profile"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "D781aD7RTUVeAU9SZDdCNciYJe8yDyZJs1JbFtHd8Urj"
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
      "args": [
        {
          "name": "validator",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "extendConversation",
      "discriminator": [
        165,
        160,
        127,
        156,
        115,
        152,
        102,
        254
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profileSender"
          ]
        },
        {
          "name": "profileSender",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_sender.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "profileOther",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "conversation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  118,
                  101,
                  114,
                  115,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "profile_sender.handle",
                "account": "profile"
              },
              {
                "kind": "account",
                "path": "profile_other.handle",
                "account": "profile"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "additionalMessages",
          "type": "u32"
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
      "name": "topUpProfile",
      "discriminator": [
        239,
        73,
        151,
        165,
        156,
        188,
        208,
        57
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profile"
          ]
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.handle",
                "account": "profile"
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
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "undelegateProfile",
      "discriminator": [
        48,
        29,
        12,
        69,
        45,
        87,
        67,
        159
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "profile"
          ]
        },
        {
          "name": "profile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  102,
                  105,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "profile.handle",
                "account": "profile"
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
    }
  ],
  "accounts": [
    {
      "name": "conversation",
      "discriminator": [
        171,
        46,
        180,
        58,
        245,
        221,
        103,
        174
      ]
    },
    {
      "name": "profile",
      "discriminator": [
        184,
        101,
        165,
        188,
        95,
        63,
        127,
        188
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidHandle",
      "msg": "The provided handle is invalid."
    },
    {
      "code": 6001,
      "name": "invalidMessage",
      "msg": "The provided message body is invalid."
    },
    {
      "code": 6002,
      "name": "conversationCountOverflow",
      "msg": "The profile conversation count overflowed."
    },
    {
      "code": 6003,
      "name": "conversationCountUnderflow",
      "msg": "The profile conversation count underflowed."
    },
    {
      "code": 6004,
      "name": "invalidConversationOwner",
      "msg": "The conversation owner does not match the signer."
    },
    {
      "code": 6005,
      "name": "invalidConversationOther",
      "msg": "The conversation other does not match the expected account."
    },
    {
      "code": 6006,
      "name": "conversationCapacityExceeded",
      "msg": "The conversation does not have enough allocated capacity for another message."
    },
    {
      "code": 6007,
      "name": "activeConversationsExist",
      "msg": "The profile still has active conversations."
    },
    {
      "code": 6008,
      "name": "invalidTopUpAmount",
      "msg": "The top up amount must be greater than zero."
    },
    {
      "code": 6009,
      "name": "invalidExtensionSize",
      "msg": "The conversation extension amount must be greater than zero."
    }
  ],
  "types": [
    {
      "name": "conversation",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "handleOwner",
            "type": "string"
          },
          {
            "name": "handleOther",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "messages",
            "type": {
              "vec": {
                "defined": {
                  "name": "conversationMessage"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "conversationMessage",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "body",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "profile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "activeConversationCount",
            "type": "u64"
          },
          {
            "name": "handle",
            "type": "string"
          }
        ]
      }
    }
  ]
};

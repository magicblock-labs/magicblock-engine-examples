# ➕ Pinocchio Counter

Simple counter program using Pinocchio and Ephemeral Rollups.

This is a port of the Rust Counter program to use Pinocchio instead of Borsh for serialization, eliminating the need for Vec types.

## Software Packages

| Software | Version | Installation Guide |
| -------- | ------- | ------------------- |
| **Solana** | 2.3.13 | [Install Solana](https://docs.anza.xyz/cli/install) |
| **Rust** | 1.85.0 | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node** | 24.10.0 | [Install Node](https://nodejs.org/en/download/current) |

## Build

```bash
cargo build-sbf
```

## Key Differences from Rust Counter

- **No Borsh**: Uses manual serialization with `to_le_bytes()` and `from_le_bytes()` for simplicity
- **No Vec**: All types use fixed-size arrays or primitives
- **Pinocchio Framework**: Leverages Pinocchio's lightweight instruction handling
- **Direct State Management**: Simple `Counter` struct with manual serialization

## Instructions

### 0: InitializeCounter
Initialize a counter PDA to 0.

### 1: IncreaseCounter
Increase the counter by a specified amount (8-byte u64 payload).

### 2: Delegate
Delegate the counter account to the Ephemeral Rollups delegation program.

### 3: CommitAndUndelegate
Commit changes and undelegate the counter account.

### 4: Commit
Commit changes to the base layer.

### 5: IncrementAndCommit
Increment counter and commit in one instruction.

### 6: IncrementAndUndelegate
Increment counter and undelegate in one instruction.

## Account Structure

- **Counter**: 8 bytes (u64 count value)

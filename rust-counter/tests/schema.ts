export class Counter {
    count = 0;
    constructor(fields: { count: number } | undefined = undefined) {
      if (fields) {
        this.count = fields.count;
      }
    }
  }
  
export const CounterSchema = new Map([
  [Counter, { kind: "struct", fields: [["count", "u64"]] }],
]);

export enum CounterInstruction {
  InitializeCounter = "0000000000000000",         // [0, 0, 0, 0, 0, 0, 0, 0]
  IncreaseCounter = "0100000000000000",           // [1, 0, 0, 0, 0, 0, 0, 0]
  Delegate = "0200000000000000",                  // [2, 0, 0, 0, 0, 0, 0, 0]
  CommitAndUndelegate = "0300000000000000",       // [3, 0, 0, 0, 0, 0, 0, 0]
  Commit = "0400000000000000",                    // [4, 0, 0, 0, 0, 0, 0, 0]
  IncrementAndCommit = "0500000000000000",        // [5, 0, 0, 0, 0, 0, 0, 0]
  IncreamentAndUndelegate = "0600000000000000",   // [6, 0, 0, 0, 0, 0, 0, 0]
  Undelegate = "C41C29CE302533A7"                 // [196, 28, 41, 206, 48, 37, 51, 167]
}

export class IncreaseCounterPayload {
    increase_by: number;

    constructor(increase_by: number) {
        this.increase_by = increase_by;
    }

    static schema = new Map([
        [
        IncreaseCounterPayload,
        {
            kind: 'struct',
            fields: [
            ['increase_by', 'u64'],
            ],
        },
        ],
    ]);
}


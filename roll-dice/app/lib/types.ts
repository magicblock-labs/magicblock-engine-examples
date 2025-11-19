export type RollEntry = {
  value: number | null
  startTime: number
  endTime: number | null
  isPending: boolean
}

export type CachedBlockhash = {
  blockhash: string
  lastValidBlockHeight: number
  timestamp: number
}


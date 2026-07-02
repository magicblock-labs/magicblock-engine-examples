import { useCallback, useEffect, useRef, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  RpsClient,
  randomChoice,
  choiceName,
  resultIsSet,
  winnerKey,
  matchDecided,
  type ChoiceName,
  type GameAccount,
} from "../lib/rps";
import {
  loadOrCreateKeypair,
  getSolBalance,
  requestAirdrop,
  transferSol,
} from "../lib/wallet";
import {
  PLAYER_STORAGE_KEY,
  GUEST_STORAGE_KEY,
  BOT_STORAGE_KEY,
  MIN_PLAY_SOL,
  AIRDROP_SOL,
  BOT_FUND_SOL,
  POLL_INTERVAL_MS,
  erExplorerTxUrl,
  targetWinsForBestOf,
} from "../lib/config";

export type GameMode =
  | { kind: "solo"; stakeSol: number; bestOf: number }
  | { kind: "host"; stakeSol: number; bestOf: number }
  | { kind: "url"; gameId: string; join: boolean };

export type Phase =
  | "loading"
  | "needs-funds"
  | "setting-up"
  | "pick"
  | "submitting"
  | "waiting"
  | "revealing"
  | "round-over"
  | "done"
  | "error";

export type LogLayer = "base" | "tee" | "settle";

export interface LogEntry {
  id: number;
  text: string;
  status: "pending" | "ok" | "err";
  layer: LogLayer;
  sig?: string;
}

export type Outcome = "win" | "lose" | "tie";

export interface ResultView {
  me: ChoiceName;
  them: ChoiceName;
  outcome: Outcome;
}

export type Role = "solo" | "host" | "joiner";

const REVEAL_ANIM_MS = 2800;
const ROUND_INTERLUDE_MS = 2200; // pause on the score between rounds
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cancelled {
  cancelled: boolean;
}

export function useGameMachine(mode: GameMode) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [role, setRole] = useState<Role>(
    mode.kind === "solo" ? "solo" : mode.kind === "host" ? "host" : "joiner",
  );
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [myAddress, setMyAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [gameIdStr, setGameIdStr] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<PublicKey | null>(null);
  const [opponentLocked, setOpponentLocked] = useState(false);
  const [myChoice, setMyChoice] = useState<ChoiceName | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [settled, setSettled] = useState(false);
  const [stakeSol, setStakeSol] = useState(0);
  const [fundNeededSol, setFundNeededSol] = useState(0);
  const [targetWins, setTargetWins] = useState(1);
  const [myWins, setMyWins] = useState(0);
  const [theirWins, setTheirWins] = useState(0);
  const [round, setRound] = useState(1);
  const [matchOver, setMatchOver] = useState(false);

  const clientRef = useRef<RpsClient | null>(null);
  const gameIdRef = useRef<BN | null>(null);
  const playersRef = useRef<{ p1: PublicKey; p2: PublicKey } | null>(null);
  const botRef = useRef<RpsClient | null>(null);
  const tokenRef = useRef<Cancelled>({ cancelled: false });
  const logIdRef = useRef(0);

  const stakeLamports = (sol: number) =>
    new BN(Math.round(sol * LAMPORTS_PER_SOL));

  // ----- log helpers -----
  const pushLog = useCallback((text: string, layer: LogLayer): number => {
    const id = ++logIdRef.current;
    setLog((l) => [...l, { id, text, layer, status: "pending" }]);
    return id;
  }, []);

  const settleLog = useCallback(
    (id: number, status: "ok" | "err", sig?: string) => {
      setLog((l) => l.map((e) => (e.id === id ? { ...e, status, sig } : e)));
    },
    [],
  );

  const step = useCallback(
    async (text: string, layer: LogLayer, fn: () => Promise<string | void>) => {
      const id = pushLog(text, layer);
      try {
        const sig = await fn();
        settleLog(id, "ok", sig ?? undefined);
        return sig;
      } catch (e) {
        settleLog(id, "err");
        throw e;
      }
    },
    [pushLog, settleLog],
  );

  // ----- funding -----
  const ensureFunds = useCallback(
    async (client: RpsClient, token: Cancelled, minSol: number) => {
      setFundNeededSol(minSol);
      let bal = await getSolBalance(client.baseConnection, client.publicKey);
      setBalance(bal);
      if (bal >= minSol) return;
      setPhase("needs-funds");
      // best-effort devnet airdrop, then wait until funded (manually or otherwise)
      requestAirdrop(
        client.baseConnection,
        client.publicKey,
        AIRDROP_SOL,
      ).catch(() => undefined);
      while (!token.cancelled) {
        await sleep(3000);
        bal = await getSolBalance(
          client.baseConnection,
          client.publicKey,
        ).catch(() => 0);
        setBalance(bal);
        if (bal >= minSol) return;
      }
      throw new Error("cancelled");
    },
    [],
  );

  // ER explorer link via the player's tokenized TEE RPC (auth required).
  const erExplorerUrl = useCallback((sig: string): string | null => {
    const rpc = clientRef.current?.teeExplorerRpc;
    return rpc ? erExplorerTxUrl(sig, rpc) : null;
  }, []);

  const airdrop = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    await requestAirdrop(client.baseConnection, client.publicKey, AIRDROP_SOL);
    setBalance(await getSolBalance(client.baseConnection, client.publicKey));
  }, []);

  // Cash out: move SOL from the active burner back to the player's real wallet.
  const withdraw = useCallback(
    async (to: PublicKey, sol: number): Promise<string> => {
      const client = clientRef.current;
      if (!client) throw new Error("No active wallet");
      const sig = await transferSol(
        client.baseConnection,
        client.keypair,
        to,
        sol,
      );
      setBalance(
        await getSolBalance(client.baseConnection, client.publicKey).catch(
          () => null,
        ),
      );
      return sig;
    },
    [],
  );

  // The robot secretly picks for the current round.
  const botPick = useCallback(
    async (gameId: BN) => {
      const bot = botRef.current;
      if (!bot) return;
      setOpponentLocked(false);
      await sleep(500);
      await step("🤖 Robot locked in a secret choice", "tee", () =>
        bot.makeChoice(gameId, randomChoice()),
      );
      setOpponentLocked(true);
    },
    [step],
  );

  // Between rounds of an undecided match: clear the round on-chain (re-privatize
  // choices) and return to the picker. Both clients call this; whoever lands
  // the reset first wins, the other's no-ops — then both poll until the round
  // is cleared and pick again.
  const advanceRound = useCallback(
    async (client: RpsClient, gameId: BN, token: Cancelled) => {
      const players = playersRef.current;
      if (!players) return;
      await sleep(ROUND_INTERLUDE_MS);
      if (token.cancelled) return;
      await client.nextRound(gameId, players.p1, players.p2).catch(() => {});
      for (let i = 0; i < 30 && !token.cancelled; i++) {
        const g = await client.fetchGameEr(gameId).catch(() => null);
        if (g && !resultIsSet(g)) break;
        await sleep(800);
      }
      if (token.cancelled) return;
      setMyChoice(null);
      setResult(null);
      setPhase("pick");
      if (botRef.current) botPick(gameId).catch(() => undefined);
    },
    [botPick],
  );

  // ----- finish / reveal -----
  const finish = useCallback(
    (
      client: RpsClient,
      game: GameAccount,
      source: "tee" | "base",
      token: Cancelled,
    ) => {
      const meIsP1 = !!game.player1?.equals(client.publicKey);
      const me = choiceName(meIsP1 ? game.player1Choice : game.player2Choice);
      const them = choiceName(meIsP1 ? game.player2Choice : game.player1Choice);
      const w = winnerKey(game);
      const outcome: Outcome =
        "tie" in game.roundResult
          ? "tie"
          : w?.equals(client.publicKey)
            ? "win"
            : "lose";
      if (me && them) setResult({ me, them, outcome });
      setMyChoice(me);
      setMyWins(meIsP1 ? game.player1Wins : game.player2Wins);
      setTheirWins(meIsP1 ? game.player2Wins : game.player1Wins);
      setRound(game.round);
      if (game.player1 && game.player2) {
        playersRef.current = { p1: game.player1, p2: game.player2 };
      }

      const decided = matchDecided(game);
      setMatchOver(decided);
      // A decided match found on base is already settled.
      setSettled(decided && source === "base");
      setPhase("revealing");
      window.setTimeout(() => {
        if (token.cancelled) return;
        if (decided) {
          setPhase("done");
        } else {
          // round over, match continues → show the score, then next round
          setPhase("round-over");
          advanceRound(client, gameIdRef.current!, token).catch(
            () => undefined,
          );
        }
      }, REVEAL_ANIM_MS);
    },
    [advanceRound],
  );

  const revealLoop = useCallback(
    async (client: RpsClient, gameId: BN, token: Cancelled) => {
      setPhase("waiting");
      let revealLogged = false;
      while (!token.cancelled) {
        const erGame = await client.fetchGameEr(gameId).catch(() => null);
        if (resultIsSet(erGame)) return finish(client, erGame!, "tee", token);
        const baseGame = await client.fetchGameBase(gameId).catch(() => null);
        if (resultIsSet(baseGame))
          return finish(client, baseGame!, "base", token);

        if (erGame?.player1 && erGame?.player2) {
          if (!opponent)
            setOpponent(
              erGame.player1.equals(client.publicKey)
                ? erGame.player2
                : erGame.player1,
            );
          const sig = await client
            .tryReveal(gameId, erGame.player1, erGame.player2)
            .catch(() => null);
          if (sig) {
            if (!revealLogged) {
              revealLogged = true;
              const id = pushLog("Both choices in — winner revealed", "tee");
              settleLog(id, "ok", sig);
            }
            const revealed = await client.fetchGameEr(gameId).catch(() => null);
            if (resultIsSet(revealed))
              return finish(client, revealed!, "tee", token);
          }
        }
        await sleep(POLL_INTERVAL_MS);
      }
    },
    [finish, pushLog, settleLog, opponent],
  );

  // ----- pick -----
  const pick = useCallback(
    async (choice: ChoiceName) => {
      const client = clientRef.current;
      const gameId = gameIdRef.current;
      const token = tokenRef.current;
      if (!client || !gameId || phase !== "pick") return;
      setPhase("submitting");
      setMyChoice(choice);
      try {
        await step("Lock in your choice 🔒", "tee", () =>
          client.makeChoice(gameId, choice),
        );
        await revealLoop(client, gameId, token);
      } catch (e) {
        if (token.cancelled) return;
        setError(errMsg(e));
        setPhase("error");
      }
    },
    [phase, revealLoop, step],
  );

  // ----- rematch / settle -----
  // Rematch = a brand-new match on the same PDAs (free games only, after a
  // match is decided). reset_game zeroes the score on-chain.
  const rematch = useCallback(async () => {
    const client = clientRef.current;
    const gameId = gameIdRef.current;
    const players = playersRef.current;
    const token = tokenRef.current;
    if (!client || !gameId || !players || phase !== "done" || settled) return;
    setPhase("setting-up");
    try {
      await step("Rematch — new match, score reset", "tee", () =>
        client.nextRound(gameId, players.p1, players.p2),
      );
      if (token.cancelled) return;
      setMyChoice(null);
      setResult(null);
      setMyWins(0);
      setTheirWins(0);
      setRound(1);
      setMatchOver(false);
      setOpponentLocked(false);
      setPhase("pick");
      if (botRef.current) botPick(gameId).catch(() => undefined);
    } catch (e) {
      if (token.cancelled) return;
      setError(errMsg(e));
      setPhase("error");
    }
  }, [phase, settled, step, botPick]);

  const settle = useCallback(async () => {
    const client = clientRef.current;
    const gameId = gameIdRef.current;
    const players = playersRef.current;
    const token = tokenRef.current;
    if (!client || !gameId || !players || settled) return;
    try {
      // 1️⃣ commit + undelegate back to base (no-op if already done by the other player)
      if (!(await client.isOnBase(gameId))) {
        await step("Commit & undelegate to Solana", "settle", () =>
          client.undelegateAll(gameId, players.p1, players.p2),
        );
      }
      // 2️⃣ wait for the game (with its result) to land on base
      for (let i = 0; i < 30 && !(await client.isOnBase(gameId)); i++) {
        await sleep(1000);
      }
      // 3️⃣ pay out the pot (winner takes all, tie refunds) — idempotent on-chain
      const game = await client.fetchGameBase(gameId).catch(() => null);
      const hasStake = !!game && game.stake.gtn(0);
      if (hasStake && !game!.paid) {
        await step("Pay out the pot 💰", "base", () =>
          client.claimPot(gameId, players.p1, players.p2),
        );
      }
      // 4️⃣ solo: sweep the robot's burner back to you so you never lose to yourself
      if (role === "solo" && botRef.current) {
        const bot = botRef.current;
        const botBal = await getSolBalance(bot.baseConnection, bot.publicKey);
        const reserve = 0.001;
        if (botBal > reserve) {
          await step("Return the robot's balance to you", "base", () =>
            transferSol(
              bot.baseConnection,
              bot.keypair,
              client.publicKey,
              botBal - reserve,
            ),
          );
        }
      }
      if (!token.cancelled) setSettled(true);
    } catch (e) {
      // the other player may have already settled+claimed
      const game = await client.fetchGameBase(gameId).catch(() => null);
      if (game?.paid || (game && game.stake.isZero() && resultIsSet(game))) {
        setSettled(true);
      } else if (!token.cancelled) {
        setError(errMsg(e));
      }
    }
  }, [settled, role, step]);

  // On the match-over screen of a 2-player free game, detect an opponent
  // starting a new match (score reset, round cleared) and follow them in.
  useEffect(() => {
    if (phase !== "done" || !matchOver || role === "solo" || settled) return;
    const token = tokenRef.current;
    const t = window.setInterval(async () => {
      const client = clientRef.current;
      const gameId = gameIdRef.current;
      if (!client || !gameId) return;
      const game = await client.fetchGameEr(gameId).catch(() => null);
      if (
        game &&
        !resultIsSet(game) &&
        !matchDecided(game) &&
        !token.cancelled
      ) {
        window.clearInterval(t);
        const id = pushLog("Opponent started a new match 🔄", "tee");
        settleLog(id, "ok");
        setMyChoice(null);
        setResult(null);
        setMyWins(0);
        setTheirWins(0);
        setRound(1);
        setMatchOver(false);
        setPhase("pick");
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [phase, matchOver, role, settled, pushLog, settleLog]);

  // ----- flows -----
  const runSolo = useCallback(
    async (token: Cancelled, stake: number, target: number) => {
      setRole("solo");
      setStakeSol(stake);
      setTargetWins(target);
      const player = new RpsClient(loadOrCreateKeypair(PLAYER_STORAGE_KEY));
      clientRef.current = player;
      setMyAddress(player.publicKey.toBase58());
      // You front both stakes in solo (yours + the robot's), plus play costs.
      await ensureFunds(player, token, MIN_PLAY_SOL + BOT_FUND_SOL + stake * 2);
      if (token.cancelled) return;

      setPhase("setting-up");
      const gameId = new BN(Date.now());
      gameIdRef.current = gameId;
      setGameIdStr(gameId.toString());

      await step("Create game & delegate to the TEE", "base", () =>
        player.createGameAndDelegate(gameId, stakeLamports(stake), target),
      );
      await step("Make your choice readable by you alone", "tee", () =>
        player.initOwnChoicePermission(gameId),
      );
      if (token.cancelled) return;
      setPhase("pick");

      // Robot opponent joins and secretly picks in the background.
      (async () => {
        const bot = new RpsClient(loadOrCreateKeypair(BOT_STORAGE_KEY));
        botRef.current = bot;
        setOpponent(bot.publicKey);
        const botNeeds = BOT_FUND_SOL + stake;
        const botBal = await getSolBalance(bot.baseConnection, bot.publicKey);
        if (botBal < botNeeds) {
          await step("Fund the robot", "base", () =>
            transferSol(
              player.baseConnection,
              player.keypair,
              bot.publicKey,
              botNeeds - botBal,
            ),
          );
        }
        await step("Robot joins & delegates the game", "base", () =>
          bot.joinGameAndDelegate(gameId),
        );
        await step("Game shared by both, robot's choice private", "tee", () =>
          bot.initGameAndOwnChoicePermissions(gameId, player.publicKey),
        );
        await sleep(600);
        await step("🤖 Robot locked in a secret choice", "tee", () =>
          bot.makeChoice(gameId, randomChoice()),
        );
        setOpponentLocked(true);
      })().catch((e) => {
        if (token.cancelled) return;
        setError(`Robot ran into a problem: ${errMsg(e)}`);
        setPhase("error");
      });
    },
    [ensureFunds, step],
  );

  const runHost = useCallback(
    async (token: Cancelled, stake: number, target: number) => {
      setRole("host");
      setStakeSol(stake);
      setTargetWins(target);
      const player = new RpsClient(loadOrCreateKeypair(PLAYER_STORAGE_KEY));
      clientRef.current = player;
      setMyAddress(player.publicKey.toBase58());
      await ensureFunds(player, token, MIN_PLAY_SOL + stake);
      if (token.cancelled) return;

      setPhase("setting-up");
      const gameId = new BN(Date.now());
      gameIdRef.current = gameId;
      setGameIdStr(gameId.toString());

      await step("Create game & delegate to the TEE", "base", () =>
        player.createGameAndDelegate(gameId, stakeLamports(stake), target),
      );
      await step("Make your choice readable by you alone", "tee", () =>
        player.initOwnChoicePermission(gameId),
      );
      if (token.cancelled) return;

      const url = `${window.location.origin}${window.location.pathname}?game=${gameId.toString()}&join=1`;
      setShareUrl(url);
      window.history.replaceState(null, "", `?game=${gameId.toString()}`);
      setPhase("pick");

      // Watch the base layer for player 2 (data stays readable there).
      (async () => {
        while (!token.cancelled) {
          const game = await player.fetchGameBase(gameId).catch(() => null);
          if (game?.player2) {
            setOpponent(game.player2);
            return;
          }
          await sleep(POLL_INTERVAL_MS);
        }
      })().catch(() => undefined);
    },
    [ensureFunds, step],
  );

  const runUrl = useCallback(
    async (gameIdStr: string, joinFlag: boolean, token: Cancelled) => {
      const gameId = new BN(gameIdStr);
      gameIdRef.current = gameId;
      setGameIdStr(gameId.toString());

      const playerKp = loadOrCreateKeypair(PLAYER_STORAGE_KEY);
      let client = new RpsClient(playerKp);
      const game = await client.fetchGameBase(gameId);
      if (!game) {
        setError(
          "Game not found — double-check the link, or the game may not have been created yet.",
        );
        setPhase("error");
        return;
      }

      const stake = game.stake.toNumber() / LAMPORTS_PER_SOL;
      setStakeSol(stake);
      setTargetWins(game.targetWins);
      const joinerNeeds = MIN_PLAY_SOL + stake;

      const me = playerKp.publicKey;
      let resumingHost = false;
      let needsJoin = false;

      if (game.player1?.equals(me)) {
        if (joinFlag && !game.player2) {
          // Own invite opened in the same browser — play as a guest identity.
          const guestKp = loadOrCreateKeypair(GUEST_STORAGE_KEY);
          client = new RpsClient(guestKp);
          const guestBal = await getSolBalance(
            client.baseConnection,
            guestKp.publicKey,
          );
          const hostBal = await getSolBalance(client.baseConnection, me);
          if (guestBal < joinerNeeds && hostBal > joinerNeeds + MIN_PLAY_SOL) {
            await transferSol(
              client.baseConnection,
              playerKp,
              guestKp.publicKey,
              joinerNeeds - guestBal,
            ).catch(() => undefined);
          }
          needsJoin = true;
        } else {
          resumingHost = true;
        }
      } else if (!game.player2) {
        needsJoin = true;
      } else if (!game.player2.equals(me)) {
        const guestKp = loadOrCreateKeypair(GUEST_STORAGE_KEY);
        if (game.player2.equals(guestKp.publicKey)) {
          client = new RpsClient(guestKp); // resume as guest
        } else {
          setError(
            "This game already has two players. Ask your friend for a fresh invite!",
          );
          setPhase("error");
          return;
        }
      }

      clientRef.current = client;
      setRole(resumingHost ? "host" : "joiner");
      setMyAddress(client.publicKey.toBase58());
      const meIsP1Resume = !!game.player1?.equals(client.publicKey);
      setMyWins(meIsP1Resume ? game.player1Wins : game.player2Wins);
      setTheirWins(meIsP1Resume ? game.player2Wins : game.player1Wins);
      setRound(game.round);
      const opp = resumingHost ? game.player2 : game.player1;
      if (opp) setOpponent(opp);
      if (resumingHost) {
        setShareUrl(
          `${window.location.origin}${window.location.pathname}?game=${gameId.toString()}&join=1`,
        );
        if (!game.player2) {
          (async () => {
            while (!token.cancelled) {
              const g = await client.fetchGameBase(gameId).catch(() => null);
              if (g?.player2) {
                setOpponent(g.player2);
                return;
              }
              await sleep(POLL_INTERVAL_MS);
            }
          })().catch(() => undefined);
        }
      }

      if (needsJoin) {
        await ensureFunds(client, token, joinerNeeds);
        if (token.cancelled) return;
        setPhase("setting-up");
        await step(
          stake > 0
            ? `Join game & stake ${stake} SOL — delegate to the TEE`
            : "Join game & delegate to the TEE",
          "base",
          () => client.joinGameAndDelegate(gameId),
        );
        await step("Game shared by both, your choice private", "tee", () =>
          client.initGameAndOwnChoicePermissions(gameId, game.player1!),
        );
        if (token.cancelled) return;
        setPhase("pick");
        return;
      }

      // Resume: figure out where we left off.
      const erGame = await client.fetchGameEr(gameId).catch(() => null);
      if (resultIsSet(erGame)) {
        finish(client, erGame!, "tee", token);
        return;
      }
      if (!erGame) {
        const baseGame = await client.fetchGameBase(gameId).catch(() => null);
        if (resultIsSet(baseGame)) {
          finish(client, baseGame!, "base", token);
          return;
        }
      }
      const existing = await client.fetchMyChoiceEr(gameId).catch(() => null);
      if (existing) {
        setMyChoice(existing);
        await revealLoop(client, gameId, token);
      } else {
        setPhase("pick");
      }
    },
    [ensureFunds, finish, revealLoop, step],
  );

  // ----- lifecycle -----
  useEffect(() => {
    const token: Cancelled = { cancelled: false };
    tokenRef.current = token;
    setPhase("loading");
    setLog([]);
    setError(null);
    setResult(null);
    setMyChoice(null);
    setOpponent(null);
    setOpponentLocked(false);
    setShareUrl(null);
    setSettled(false);
    setStakeSol(0);
    setFundNeededSol(0);
    setTargetWins(1);
    setMyWins(0);
    setTheirWins(0);
    setRound(1);
    setMatchOver(false);
    playersRef.current = null;
    botRef.current = null;

    const run = async () => {
      const target = mode.kind === "url" ? 1 : targetWinsForBestOf(mode.bestOf);
      if (mode.kind === "solo") await runSolo(token, mode.stakeSol, target);
      else if (mode.kind === "host")
        await runHost(token, mode.stakeSol, target);
      else await runUrl(mode.gameId, mode.join, token);
    };
    run().catch((e) => {
      if (token.cancelled) return;
      setError(errMsg(e));
      setPhase("error");
    });

    return () => {
      token.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Balance ticker for the wallet badge.
  useEffect(() => {
    const t = window.setInterval(async () => {
      const client = clientRef.current;
      if (!client) return;
      const bal = await getSolBalance(
        client.baseConnection,
        client.publicKey,
      ).catch(() => null);
      if (bal !== null) setBalance(bal);
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);

  return {
    phase,
    role,
    log,
    error,
    myAddress,
    balance,
    shareUrl,
    gameIdStr,
    opponent,
    opponentLocked,
    myChoice,
    result,
    settled,
    stakeSol,
    potSol: stakeSol * 2,
    fundNeededSol,
    targetWins,
    myWins,
    theirWins,
    round,
    matchOver,
    pick,
    rematch,
    settle,
    airdrop,
    withdraw,
    erExplorerUrl,
  };
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

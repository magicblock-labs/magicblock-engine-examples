import { PublicKey } from "@solana/web3.js";

import { MagicBlockEngine } from "../engine/MagicBlockEngine";

import { Game } from "../../../backend/target/types/game";
import { Generate } from "../../../backend/target/types/generate";
import { Join } from "../../../backend/target/types/join";
import { Start } from "../../../backend/target/types/start";
import { Command } from "../../../backend/target/types/command";
import { Tick } from "../../../backend/target/types/tick";
import { Finish } from "../../../backend/target/types/finish";

import * as GameIdl from "../../../backend/target/idl/game.json";
import * as GenerateIdl from "../../../backend/target/idl/generate.json";
import * as JoinIdl from "../../../backend/target/idl/join.json";
import * as StartIdl from "../../../backend/target/idl/start.json";
import * as CommandIdl from "../../../backend/target/idl/command.json";
import * as TickIdl from "../../../backend/target/idl/tick.json";
import * as FinishIdl from "../../../backend/target/idl/finish.json";

const componentGame = GameIdl as Game;
const systemGenerate = GenerateIdl as Generate;
const systemJoin = JoinIdl as Join;
const systemStart = StartIdl as Start;
const systemCommand = CommandIdl as Command;
const systemTick = TickIdl as Tick;
const systemFinish = FinishIdl as Finish;

export const COMPONENT_GAME_PROGRAM_ID = new PublicKey(componentGame.address);
export const SYSTEM_GENERATE_PROGRAM_ID = new PublicKey(systemGenerate.address);
export const SYSTEM_JOIN_PROGRAM_ID = new PublicKey(systemJoin.address);
export const SYSTEM_START_PROGRAM_ID = new PublicKey(systemStart.address);
export const SYSTEM_COMMAND_PROGRAM_ID = new PublicKey(systemCommand.address);
export const SYSTEM_TICK_PROGRAM_ID = new PublicKey(systemTick.address);
export const SYSTEM_FINISH_PROGRAM_ID = new PublicKey(systemFinish.address);

export function getComponentGameOnChain(engine: MagicBlockEngine) {
  return engine.getProgramOnChain<Game>(componentGame);
}

export function getComponentGameOnEphem(engine: MagicBlockEngine) {
  return engine.getProgramOnEphem<Game>(componentGame);
}

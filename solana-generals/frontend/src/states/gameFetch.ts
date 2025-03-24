import { PublicKey } from "@solana/web3.js";
import { MagicBlockEngine } from "../engine/MagicBlockEngine";
import { getComponentGameOnEphem } from "./gamePrograms";

export async function gameFetch(engine: MagicBlockEngine, gamePda: PublicKey) {
  const componentGame = getComponentGameOnEphem(engine);
  return componentGame.account.game.fetchNullable(gamePda);
}

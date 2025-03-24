use bolt_lang::*;

declare_id!("C5iL81s4Fu6SnkQEfixFZpKPRQ32fqVizpotoLVTxA2n");

#[component(delegate)]
pub struct Game {
    pub status: GameStatus,
    pub size_x: u8,
    pub size_y: u8,
    pub players: [GamePlayer; 2],
    pub cells: [GameCell; 128], // max grid size is 16x8=128
    pub tick_next_slot: u64,    // TODO(vbrunet) - use more precise clock
}

#[component_deserialize]
#[derive(PartialEq)]
pub enum GameStatus {
    Generate,
    Lobby,
    Playing,
    Finished,
}

#[component_deserialize]
#[derive(PartialEq, Default)]
pub struct GamePlayer {
    pub ready: bool,
    pub authority: Pubkey,
    pub last_action_slot: u64,
}

#[component_deserialize]
#[derive(PartialEq)]
pub struct GameCell {
    pub kind: GameCellKind,
    pub owner: GameCellOwner,
    pub strength: u8,
}

#[component_deserialize]
#[derive(PartialEq)]
pub enum GameCellKind {
    Field,
    City,
    Capital,
    Mountain,
    Forest,
}

#[component_deserialize]
#[derive(PartialEq)]
pub enum GameCellOwner {
    Player(u8),
    Nobody,
}

/**
 * The initial state of the component when initialized
 */
impl Default for Game {
    fn default() -> Self {
        Self::new(GameInit {
            status: GameStatus::Generate,
            size_x: 16,
            size_y: 8,
            players: [GamePlayer::default(); 2],
            cells: [GameCell::field(); 128],
            tick_next_slot: 0,
        })
    }
}

/**
 * Utility functions to manipulate the game's cells
 */
impl Game {
    pub fn compute_index(&self, x: u8, y: u8) -> Result<usize> {
        if x >= self.size_x || y >= self.size_y {
            return Err(GameError::CellIsOutOfBounds.into());
        }
        Ok(usize::from(y) * usize::from(self.size_x) + usize::from(x))
    }
    pub fn get_cell(&self, x: u8, y: u8) -> Result<&GameCell> {
        Ok(&self.cells[self.compute_index(x, y)?])
    }
    pub fn set_cell(&mut self, x: u8, y: u8, cell: GameCell) -> Result<()> {
        self.cells[self.compute_index(x, y)?] = cell;
        Ok(())
    }
}

/**
 * Utility functions for standard cell types
 */
impl GameCell {
    pub fn field() -> GameCell {
        GameCell {
            kind: GameCellKind::Field,
            owner: GameCellOwner::Nobody,
            strength: 0,
        }
    }
    pub fn city() -> GameCell {
        GameCell {
            kind: GameCellKind::City,
            owner: GameCellOwner::Nobody,
            strength: 40,
        }
    }
    pub fn capital(player_slot: u8) -> GameCell {
        GameCell {
            kind: GameCellKind::Capital,
            owner: GameCellOwner::Player(player_slot),
            strength: 20,
        }
    }
    pub fn mountain() -> GameCell {
        GameCell {
            kind: GameCellKind::Mountain,
            owner: GameCellOwner::Nobody,
            strength: 0,
        }
    }
    pub fn forest() -> GameCell {
        GameCell {
            kind: GameCellKind::Forest,
            owner: GameCellOwner::Nobody,
            strength: 0,
        }
    }
}

#[error_code]
pub enum GameError {
    #[msg("The game status is not currently set to Generate.")]
    StatusIsNotGenerate,
    #[msg("The game status is not currently set to Lobby.")]
    StatusIsNotLobby,
    #[msg("The game status is not currently set to Playing.")]
    StatusIsNotPlaying,
    #[msg("A player already joined in this slot.")]
    PlayerAlreadyJoined,
    #[msg("The player in this slot doesn't match the payer")]
    PlayerIsNotPayer,
    #[msg("The player in this slot is not ready to start")]
    PlayerIsNotReady,
    #[msg("The cell's position is out of bounds")]
    CellIsOutOfBounds,
    #[msg("The cells specified are not adjacent")]
    CellsAreNotAdjacent,
    #[msg("The cell's strength is insufficient")]
    CellStrengthIsInsufficient,
    #[msg("The cell is not owned by the player")]
    CellIsNotOwnedByPlayer,
    #[msg("The cell cannot be interacted with")]
    CellIsNotWalkable,
}

use chatgpt::types::{ChatMessage, Role};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::time::{Duration, SystemTime};

struct TimedChatMessage {
    message: ChatMessage,
    timestamp: SystemTime,
}

pub struct InteractionMemory {
    memory: HashMap<Pubkey, Vec<TimedChatMessage>>,
    max_history: usize,
}

impl InteractionMemory {
    pub fn new(max_history: usize) -> Self {
        InteractionMemory {
            memory: HashMap::new(),
            max_history,
        }
    }

    pub fn add_interaction(&mut self, pubkey: Pubkey, text: String, role: Role) {
        let new_interaction = TimedChatMessage {
            message: ChatMessage {
                role,
                content: text,
            },
            timestamp: SystemTime::now(),
        };
        let history = self.memory.entry(pubkey).or_default();
        history.push(new_interaction);

        if history.len() > self.max_history {
            history.remove(0); // Remove the oldest entry
        }
        if rand::random::<f64>() < 0.01 {
            self.clean_old_entries();
        }
    }

    pub fn get_history(&self, pubkey: &Pubkey) -> Option<Vec<ChatMessage>> {
        self.memory.get(pubkey).map(|history| {
            history
                .iter()
                .map(|timed_msg| timed_msg.message.clone())
                .collect()
        })
    }

    pub fn clean_old_entries(&mut self) {
        println!("\nCleaning old entries\n");
        let max_retention = Duration::from_secs(1200);
        let now = SystemTime::now();

        self.memory.retain(|_, history| {
            history.retain(|interaction| {
                now.duration_since(interaction.timestamp)
                    .unwrap_or_else(|_| Duration::new(0, 0))
                    < max_retention
            });
            !history.is_empty()
        });
    }
}

//! Pure ARXML/ECUC core engine.
//!
//! This crate has no Node, N-API or VS Code dependency. The stdio process wrapper
//! (`arxml-engine`), the parity CLI (`arxml-cli`) and the test oracle live in
//! sibling crates; this crate owns the parser, ids, rows, conditions, validation
//! and edit planning.

#![forbid(unsafe_code)]

pub mod ecuc;

/// The protocol version the TypeScript client expects from the engine process.
pub const ENGINE_PROTOCOL: u32 = 1;

/// The internal engine version. This is not a product release version.
pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// A stable, side-effect-free probe used by the loader and the smoke test.
pub fn engine_hello() -> String {
    format!("arxml-core {}", engine_version())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_names_the_engine() {
        assert_eq!(engine_hello(), format!("arxml-core {}", engine_version()));
    }

    #[test]
    fn protocol_is_stable_for_this_release() {
        assert_eq!(ENGINE_PROTOCOL, 1);
    }
}

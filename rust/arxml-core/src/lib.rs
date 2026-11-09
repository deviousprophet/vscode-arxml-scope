//! Pure ARXML/ECUC core engine.
//!
//! This crate has no Node, N-API or VS Code dependency. The Node binding and the
//! parity CLI live in sibling crates; later milestones move the parser, index,
//! validation and semantic matcher here.

#![forbid(unsafe_code)]

/// The ABI expected by the TypeScript native loader.
pub const ENGINE_ABI: u32 = 1;

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
    fn abi_is_stable_for_the_foundation() {
        assert_eq!(ENGINE_ABI, 1);
    }
}

//! N-API boundary for the ARXML Scope core engine.
//!
//! The foundation exports only the probe functions the loader and smoke test
//! need. Later milestones add coarse index/validation/diff calls; keep the
//! boundary operation-shaped rather than exposing the whole Rust model.
//!
//! The `napi` macro generates the FFI glue (including its own `unsafe` blocks);
//! this crate is the reviewed boundary. `arxml-core` keeps `forbid(unsafe_code)`.

use napi_derive::napi;

#[napi]
pub fn engine_hello() -> String {
    arxml_core::engine_hello()
}

#[napi]
pub fn engine_version() -> String {
    arxml_core::engine_version().to_string()
}

#[napi]
pub fn engine_abi() -> u32 {
    arxml_core::ENGINE_ABI
}
